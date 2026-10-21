// PSD mockup templates kept in a folder on this PC: config.local.json gives a
// shop a "mockupFolder". The worker reports the PSDs in it (and in its
// subfolders) to the shop and renders straight from the files, so templates are
// never uploaded to or downloaded from R2, and an edited PSD is picked up on
// the next scan.
import fs from 'node:fs/promises';
import path from 'node:path';

const PSD=/\.(psd|psb)$/i;
const MAX_FILES=600,MAX_DEPTH=4;

// Relative paths use "/" so they read the same on every PC.
export async function scanMockupFolder(folder){
  const root=path.resolve(folder),files=[];
  async function walk(dir,depth){
    let entries;
    try{entries=await fs.readdir(dir,{withFileTypes:true})}catch(error){
      if(dir===root)throw Error('Mockup folder not found: '+folder);
      return;
    }
    for(const entry of entries.sort((a,b)=>a.name.localeCompare(b.name))){
      if(files.length>=MAX_FILES)return;
      // Hidden files and Photoshop's temporary "~" copies are skipped.
      if(entry.name.startsWith('.')||entry.name.startsWith('~'))continue;
      const full=path.join(dir,entry.name);
      if(entry.isDirectory()){if(depth<MAX_DEPTH)await walk(full,depth+1);continue}
      if(!entry.isFile()||!PSD.test(entry.name))continue;
      const stat=await fs.stat(full).catch(()=>null);
      if(!stat||stat.size<100)continue;
      files.push({path:path.relative(root,full).split(path.sep).join('/'),size:stat.size,mtimeMs:Math.round(stat.mtimeMs)});
    }
  }
  await walk(root,0);
  return files;
}

// The file for a template's relative path; never outside the folder.
export function mockupFolderFile(folder,relativePath){
  const root=path.resolve(folder),full=path.resolve(root,...String(relativePath).split('/'));
  if(!full.startsWith(root+path.sep))throw Error('Template path is outside the mockup folder.');
  return full;
}

// Identifies one version of a PSD that is edited in place.
export const localPsdVersion=(relativePath,mtimeMs)=>'pc:'+relativePath+'@'+Math.round(Number(mtimeMs)||0);

// Orientation from the artwork layer's shape: within 4% of square is square,
// and about twice as wide as tall or wider is panoramic (the same ratio as the
// shop's PANORAMIC_RATIO in src/mockup-orientation.mjs).
export const PANORAMIC_RATIO=1.9;
export function orientationFromShape({width,height}){
  const ratio=Number(width)/Number(height);
  if(!(ratio>0))return 'unclassified';
  if(Math.abs(ratio-1)<=0.04)return 'square';
  if(ratio>=PANORAMIC_RATIO)return 'panoramic';
  return ratio>1?'landscape':'portrait';
}
