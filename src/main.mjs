import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { searchGames, getGameDetails, downloadBestCover, safeFolderName } from './backend/game-metadata.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function libraryPaths() {
  const root = path.join(app.getPath('userData'), 'library');
  return { root, index: path.join(root, 'library.json') };
}
async function readLibrary() {
  const { root, index } = libraryPaths();
  await mkdir(root, { recursive: true });
  try { const parsed = JSON.parse(await readFile(index, 'utf8')); return Array.isArray(parsed) ? parsed : []; }
  catch { return []; }
}
async function writeLibrary(items) {
  const { root, index } = libraryPaths();
  await mkdir(root, { recursive: true });
  await writeFile(index, JSON.stringify(items, null, 2), 'utf8');
}
function identity(s){ return { provider:s?.provider||null, providerId:s?.providerId||null, sourceUrl:s?.sourceUrl||null, title:s?.title||null }; }

async function importSelectedGame(win, payload) {
  const exePath = String(payload?.exePath || '').trim();
  const selected = payload?.selected;
  if (!exePath || !selected?.title) throw new Error('Executable and game result are required.');
  const notify=(progress,message)=>win?.webContents.send('game:import-progress',{progress,message});
  notify(10,'Preparing game information…');
  const details=await getGameDetails(selected.title,{preferredProvider:selected.provider,preferredProviderId:selected.providerId,preferredSourceUrl:selected.sourceUrl});
  const record=details?.record||{title:selected.title};
  notify(55,'Downloading artwork and metadata…');
  const gameId=`${safeFolderName(record.title||selected.title)}-${Date.now()}`;
  const {root}=libraryPaths(), gameDir=path.join(root,gameId);
  await mkdir(gameDir,{recursive:true});
  let coverFile=null;
  const candidates=[...new Set([selected.coverImageUrl,...(record.coverImageCandidates||[]),record.coverImageUrl].filter(Boolean))];
  if(candidates.length){
    try{
      const cover=await downloadBestCover(candidates,{timeoutMs:10000});
      if(cover?.buf?.byteLength){
        const ct=String(cover.contentType||'').toLowerCase(), ext=ct.includes('png')?'png':ct.includes('webp')?'webp':'jpg';
        coverFile=path.join(gameDir,`cover.${ext}`);
        await writeFile(coverFile,cover.buf);
      }
    }catch{}
  }
  const entry={
    id:gameId,title:record.title||selected.title,exePath,coverFile,addedAt:new Date().toISOString(),
    selectedResult:identity(selected),
    metadata:{releaseDate:record.releaseDate||null,developers:record.developers||[],publishers:record.publishers||[],genres:record.genres||[],platforms:record.platforms||[],summary:record.summary||record.description||null,storeUrl:record.storeUrl||selected.sourceUrl||null}
  };
  await writeFile(path.join(gameDir,'metadata.json'),JSON.stringify({...record,selectedResult:identity(selected)},null,2),'utf8');
  const library=await readLibrary(), existing=library.findIndex(x=>x.exePath?.toLowerCase()===exePath.toLowerCase());
  if(existing>=0) library.splice(existing,1,entry); else library.unshift(entry);
  await writeLibrary(library);
  notify(100,'Added to Library');
  return entry;
}
function createWindow(){
  const win=new BrowserWindow({width:1280,height:800,minWidth:960,minHeight:640,backgroundColor:'#0b0f17',webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false}});
  win.loadFile(path.join(__dirname,'renderer','index.html')); return win;
}
app.whenReady().then(()=>{
  const win=createWindow();
  ipcMain.handle('game:choose-executable',async()=>{
    const r=await dialog.showOpenDialog(win,{title:'Select game executable',properties:['openFile'],filters:[{name:'Windows Executable',extensions:['exe']}]});
    return r.canceled?null:(r.filePaths[0]||null);
  });
  ipcMain.handle('game:search',async(_e,q)=>{q=String(q||'').trim();if(!q)return{results:[]};const r=await searchGames(q,{limit:12});return{results:r.results||[]};});
  ipcMain.handle('game:add',async(_e,p)=>importSelectedGame(win,p));
  ipcMain.handle('library:list',async()=>readLibrary());
  app.on('activate',()=>{if(BrowserWindow.getAllWindows().length===0)createWindow();});
});
app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit();});
