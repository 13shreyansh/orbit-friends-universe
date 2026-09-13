import { getFriendsStory } from '../src/demo/friendsStories.ts'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'

{
  const people=['ross','rachel','monica','chandler','joey','phoebe']
  const collections=new Set()
  const leadPhotos=new Set()
  let pairs=0
  for (let i=0;i<people.length;i++) {
    assert.equal(getFriendsStory(`friends-${people[i]}`,`friends-${people[i]}`),null)
    for (let j=i+1;j<people.length;j++) {
      const story=getFriendsStory(`friends-${people[i]}`,`friends-${people[j]}`)
      assert(story)
      assert.deepEqual(story,getFriendsStory(`friends-${people[j]}`,`friends-${people[i]}`))
      assert(story.title && story.relationship && story.description)
      assert(story.photos.length>=3 && story.photos.length<=8)
      const urls=story.photos.map(photo=>photo.url)
      assert.equal(new Set(urls).size,urls.length)
      for (const photo of story.photos) {
        assert(photo.caption.trim())
        const assetPath = photo.url.replace(/^\/orbit-friends-universe\//, '/')
        assert(assetPath.startsWith('/friends/') || assetPath.startsWith('/friends-pairs/'))
        assert((await readFile(path.join('public',assetPath))).length>0)
      }
      collections.add([...urls].sort().join('|'))
      leadPhotos.add(urls[0])
      pairs++
    }
  }
  assert.equal(pairs,15)
  assert.equal(collections.size,15,'Every relationship needs a distinct photo collection')
  assert.equal(leadPhotos.size,15,'Every relationship needs a distinct opening photograph')
  for (const invalid of ['ross','friends-gunther','album-owner-ross','friends-ROSS','friends-ross-extra','']) {
    assert.equal(getFriendsStory(invalid,'friends-rachel'),null)
    assert.equal(getFriendsStory('friends-ross',invalid),null)
  }
  console.log('PASS: all 15 Friends pair stories are symmetric, distinct, have 3–8 existing photos and captions, and reject self/unknown IDs.')
}
