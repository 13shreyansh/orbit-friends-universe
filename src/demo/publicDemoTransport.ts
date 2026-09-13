/** Public prepared demo: no authentication service or personal data is exposed. */
export function installPublicDemoTransport() {
  const networkFetch = window.fetch.bind(window)
  const base = import.meta.env.BASE_URL
  const names = new Set(['ross','monica','rachel','chandler','joey','phoebe'])
  let selected = sessionStorage.getItem('orbit-public-perspective') || 'ross'
  const cache = new Map<string, Promise<Record<string, any>>>()
  function data(name: string) {
    if (!cache.has(name)) cache.set(name, networkFetch(`${base}demo-data/${name}.json`).then(r => {if(!r.ok)throw new Error('Demo data unavailable'); return r.json()}))
    return cache.get(name)!
  }
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {status,headers:{'content-type':'application/json','x-server-time':new Date().toISOString()}})
  window.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.href)
    if(url.origin !== location.origin || !url.pathname.startsWith('/api/')) return networkFetch(input,init)
    const path=url.pathname
    if(path === '/api/auth/signin') {
      const body=JSON.parse(String(init?.body || '{}')); const name=String(body.email || '').split('@')[0]
      if(!names.has(name)) return json({detail:'Choose one of the six demo friends.'},400)
      selected=name;sessionStorage.setItem('orbit-public-perspective',name)
      return json((await data(selected)).cosmos)
    }
    if(path === '/api/auth/signout') return json({ok:true})
    const fixture = await data(selected)
    if(path === '/api/cosmos') return json(fixture.cosmos)
    if(path === '/api/v1/universe/snapshot') return json(fixture.snapshot)
    if(path === '/api/v1/universe/window') return json(fixture.window)
    if(path === '/api/v1/users/me/intake') return json(fixture.intake)
    if(path.includes('signals')) return json({signals:[]})
    if(path === '/api/nebulae') return json({joined:[],recommended:[],searchResults:[],catalog:[],pagination:{page:1,pageSize:6,total:0,totalPages:1}})
    if(path === '/api/public/auth-config') return json({emailVerificationRequired:false,emailDeliveryConfigured:false})
    return json({detail:'This action is outside the prepared public demo.'},404)
  }
}
