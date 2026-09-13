import { useEffect, useRef, useState } from 'react'
import { ArrowRight, Check, FolderOpen, ImagePlus, LoaderCircle, Orbit, Sparkles, X } from 'lucide-react'
import { useProductStore } from './product/store/useProductStore'
import { adoptSessionToken } from './product/api/apiClient'
import type { AuthSession, CosmosPayload } from './product/contracts'
import './album.css'

type Album = { id:string; name:string; photos:{url:string;name:string}[]; groups:{name:string;description:string;indexes:number[];archetype:string}[] }
export function AlbumImport() {
  const phase=useProductStore(s=>s.phase)
  const [open,setOpen]=useState(false),[name,setName]=useState('The one with all of us'),[link,setLink]=useState('')
  const [files,setFiles]=useState<File[]>([]),[thumbs,setThumbs]=useState<string[]>([]),[busy,setBusy]=useState(''),[error,setError]=useState('')
  const [album,setAlbum]=useState<Album|null>(null),[session,setSession]=useState<AuthSession|null>(null),[elapsed,setElapsed]=useState(0)
  const input=useRef<HTMLInputElement>(null)
  const [demoCount,setDemoCount]=useState<number|null>(null)
  useEffect(()=>{fetch('/orbit-friends-universe/friends/album.json').then(r=>r.json()).then(data=>setDemoCount(data.count)).catch(()=>{})},[])
  useEffect(()=>{const urls=files.map(file=>URL.createObjectURL(file));setThumbs(urls);return()=>urls.forEach(URL.revokeObjectURL)},[files])
  useEffect(()=>{if(!busy){setElapsed(0);return}const timer=setInterval(()=>setElapsed(t=>t+1),1000);return()=>clearInterval(timer)},[busy])
  function addFiles(incoming:File[]) {if(files.length+incoming.length>36){setError('Choose up to 36 photos for this universe.');return}if(incoming.some(f=>!['image/jpeg','image/png','image/webp'].includes(f.type))){setError('Use JPEG, PNG or WebP photographs.');return}setError('');setFiles(old=>[...old,...incoming])}
  async function smallPhoto(file:File) {
    const bitmap=await createImageBitmap(file)
    if(bitmap.width*bitmap.height>80000000){bitmap.close();throw new Error('Use a smaller version of this photograph.')}
    const scale=Math.min(1,1600/Math.max(bitmap.width,bitmap.height)),canvas=document.createElement('canvas')
    canvas.width=Math.round(bitmap.width*scale);canvas.height=Math.round(bitmap.height*scale)
    canvas.getContext('2d')!.drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close()
    const blob=await new Promise<Blob|null>(resolve=>canvas.toBlob(resolve,'image/jpeg',.86))
    if(!blob)throw new Error('A photo could not be read.');return blob
  }
  async function preview(demo=false) {
    setError('');setBusy(demo?'Opening the Friends album…':'Reading your photographs…')
    try {
      const form=new FormData();form.append('name',name);form.append('demo',String(demo))
      if(link&&!demo)form.append('drive_url',link)
      if(!demo&&!link)for(const file of files)form.append('files',await smallPhoto(file),file.name)
      setBusy('Finding the places and occasions that belong together…')
      const response=await fetch('/api/orbit/albums/preview',{method:'POST',body:form})
      const result=await response.json();if(!response.ok)throw new Error(result.detail||'The album could not be read. Please retry.')
      setAlbum(result.album);setSession(result.session)
    } catch(cause){setError(cause instanceof Error?cause.message:'Could not build the album.')}finally{setBusy('')}
  }
  async function create() {
    if(!album||!session)return
    setError('');setBusy('Giving each chapter its own gravity…')
    try {
      const response=await fetch(`/api/orbit/albums/${album.id}/confirm`,{method:'POST',headers:{Authorization:`Bearer ${session.token}`}})
      const result: {cosmos:CosmosPayload;detail?:string}=await response.json()
      if(!response.ok)throw new Error(result.detail||'The universe could not be saved.')
      adoptSessionToken(session.token)
      useProductStore.getState().authenticate(session,result.cosmos.profile,result.cosmos,{arrivalComplete:true})
      useProductStore.getState().setUniverseScale('galaxy')
      setOpen(false);setFiles([]);setAlbum(null);setSession(null)
    } catch(cause){setError(cause instanceof Error?cause.message:'Please retry.')}finally{setBusy('')}
  }
  return <>
    <button className={'album-launch '+(phase==='auth'?'album-launch-entry':'')} onClick={()=>setOpen(true)}><ImagePlus size={17}/>{phase==='auth'?'Make a universe from your album':'Add a photo album'}</button>
    {open&&<div className="album-scrim" onClick={()=>{if(!busy)setOpen(false)}}><section role="dialog" aria-modal="true" aria-labelledby="album-title" className="album-dialog" onClick={e=>e.stopPropagation()}>
      <button className="album-close" aria-label="Close album importer" disabled={!!busy} onClick={()=>setOpen(false)}><X size={20}/></button>
      <div className="album-eyebrow"><Orbit size={15}/> FROM AN ALBUM TO A UNIVERSE</div>
      <h2 id="album-title">{album?'Your memories found their worlds.':'Bring your people.\nBring your photographs.'}</h2>
      <p className="album-lead">{album?`${album.photos.length} photographs, grouped into ${album.groups.length} chapters. Review them before you enter.`:'A holiday. A favourite place. The everyday moments. Give them a universe of their own.'}</p>
      {album?<>
        <div className="album-chapters">{album.groups.map((group,i)=><article key={i}><div className={'chapter-orb orb-'+i}/><div className="chapter-copy"><span>PLANET {String(i+1).padStart(2,'0')}</span><h3>{group.name}</h3><p>{group.description}</p><div className="chapter-photos">{group.indexes.map(index=><img key={index} src={album.photos[index].url} alt={album.photos[index].name}/>)}</div></div><Check size={17}/></article>)}</div>
        <div className="album-review-note">Each planet is a chapter from your album. Its photographs stay attached to their original moments.</div>
        <button className="album-primary" disabled={!!busy} onClick={()=>void create()}>{busy?<LoaderCircle className="friends-spin" size={19}/>:<Sparkles size={18}/>} {busy||'Create this universe'}</button>
        <button className="album-secondary" disabled={!!busy} onClick={()=>setAlbum(null)}>Choose different photos</button>
      </>:<>
        <label className="album-label" htmlFor="album-name">Give your universe a name</label><input id="album-name" className="album-input" value={name} onChange={e=>setName(e.target.value)} maxLength={80}/>
        <label className="album-label" htmlFor="album-link">Import a public Google Drive folder</label><div className="album-link"><FolderOpen size={18}/><input id="album-link" placeholder="https://drive.google.com/drive/folders/…" value={link} onChange={e=>setLink(e.target.value)}/></div>
        <div className="album-divider"><span/>or bring the photographs<span/></div>
        <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={e=>{addFiles(Array.from(e.target.files||[]));e.target.value=''}}/>
        <button className="album-drop" disabled={!!busy||!!link} onClick={()=>input.current?.click()} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();if(!busy&&!link)addFiles(Array.from(e.dataTransfer.files))}}><ImagePlus size={27}/><strong>Drop a little of your life here</strong><span>Choose 1–36 photographs · JPEG, PNG or WebP</span></button>
        {!!files.length&&<div className="album-thumbs">{thumbs.map((url,i)=><div key={url}><img src={url} alt={files[i]?.name}/><button disabled={!!busy} aria-label={`Remove ${files[i]?.name}`} onClick={()=>setFiles(old=>old.filter((_,j)=>i!==j))}><X size={12}/></button></div>)}</div>}
        <button className="album-primary" disabled={!!busy||(!files.length&&!link)||name.trim().length<2} onClick={()=>void preview()}>{busy?<LoaderCircle className="friends-spin" size={18}/>:<Sparkles size={18}/>} {busy||'Discover my memory planets'}</button>
        {!busy&&<button className="album-demo" onClick={()=>void preview(true)}><img src="/orbit-friends-universe/friends/central-perk-photo-sharing.jpg" alt="Friends sharing photographs"/><span><strong>Try the Friends album</strong><small>{demoCount ? `${demoCount} photographs` : 'A life in photographs'} · Coffee, home, holidays and weddings</small></span><ArrowRight size={18}/></button>}
        <p className="album-disclosure">Photos are sent to OpenAI to group places and occasions. Private Google Photos albums can be downloaded and uploaded here.</p>
      </>}
      {busy&&<div className="album-progress" role="status"><div/><span>{elapsed<15?'Looking at the photos…':elapsed<35?'Connecting the shared moments…':'Still working on your album…'} {elapsed}s</span></div>}
      {error&&<p className="album-error" role="alert">{error}</p>}
    </section></div>}
  </>
}
