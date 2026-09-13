import { build } from 'vite'
import { createRequire } from 'node:module'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'

const temporary = await mkdtemp(path.join(tmpdir(), 'orbit-book-'))
try {
  const bundle = path.join(temporary, 'book.cjs')
  await build({
    configFile: false,
    logLevel: 'silent',
    ssr: { noExternal: true },
    build: {
      ssr: 'src/modules/memory-book/convertMemoryToPages.ts',
      outDir: temporary,
      rollupOptions: { output: { format: 'cjs', entryFileNames: 'book.cjs' } },
    },
  })
  const {convertMemoryToPages} = createRequire(import.meta.url)(bundle)
  const make = (id,url) => ({id,eventTime:'2026-09-13',eventType:'album_import',summary:'Coffee together',rawText:'Coffee at the orange couch',media:[{type:'image',url,name:id}]})
  const records=[make('first','/a.jpg'),make('second','/b.jpg'),make('shared-copy','/a.jpg'),make('third','/c.jpg')]
  const pages=convertMemoryToPages('Central Perk',[],records), photos=pages.filter(p=>p.type==='photo')
  assert.equal(photos.length,3)
  assert.equal(new Set(photos.map(p=>p.mediaUrl)).size,3)
  assert(photos.every(p=>p.createdAt===undefined))
  assert.equal(pages.filter(p=>p.type==='text').length,1)
  const collection=make('collection','/1.jpg')
  collection.eventType='shared_activity'
  collection.media=Array.from({length:6},(_,i)=>({type:'image',url:`/${i}.jpg`,name:`Photo ${i}`}))
  assert.equal(convertMemoryToPages('Rachel',[],[collection,collection]).filter(p=>p.type==='photo').length,6)
  const album=JSON.parse(await readFile('public/friends/album.json','utf8'))
  assert.equal(album.photos.length,31)
  assert.equal(new Set(album.photos.map(photo=>photo.file)).size,31)
  for (const photo of album.photos) assert((await readFile(path.join('public/friends',photo.file))).length>0)
  console.log('PASS:31 demo assets; every distinct photo appears once; all six collection photos remain; imported dates stay unknown; repeated notes are removed.')
} finally { await rm(temporary,{recursive:true,force:true}) }
