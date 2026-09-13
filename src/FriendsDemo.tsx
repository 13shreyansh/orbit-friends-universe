import { useState } from 'react'
import { Orbit, ArrowUpRight, LoaderCircle } from 'lucide-react'
import { adoptSessionToken } from './product/api/apiClient'
import { useProductStore } from './product/store/useProductStore'
import './friends.css'

const people = ['Monica', 'Rachel', 'Chandler', 'Joey', 'Phoebe', 'Ross']

export function FriendsDemo({onEnter}: {onEnter?:()=>void}) {
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  async function enter(name: string) {
    setBusy(name); setError('')
    try {
      const response = await fetch('/api/auth/signin', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:`${name.toLowerCase()}@friends.local`,password:'friends-demo-only'})})
      const result = await response.json()
      if(!response.ok) throw new Error(result.detail || 'Please try again.')
      adoptSessionToken(result.session.token)
      useProductStore.getState().authenticate(result.session, result.profile, result, { arrivalComplete: true })
      useProductStore.getState().setUniverseScale('galaxy')
      sessionStorage.removeItem('orbit-shared-visit')
      history.replaceState(null,'',location.pathname)
      onEnter?.()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'The universe could not open. Please retry.') }
    finally { setBusy('') }
  }
  return <main className="friends-entry">
    <img className="friends-backdrop" src="/orbit-friends-universe/friends/fountain-opening.jpg" alt="The six Friends at the fountain" />
    <header className="friends-brand"><Orbit size={30}/><strong>orbit</strong><span>A UNIVERSE OF US</span></header>
    <section className="friends-intro">
      <div className="friends-kicker">THE FRIENDS UNIVERSE <i/><i/><i/></div>
      <h1>The ones who<br/>became our world.</h1>
      <p>Six friends. A lifetime of shared stories.<br/>Step into their universe, through anyone’s eyes.</p>
      <div className="friends-choose">THE FRIENDS UNIVERSE IS READY · ENTER AS</div>
      <div className="friends-people">{people.map((name,i)=><button key={name} onClick={()=>void enter(name)} disabled={!!busy}><span className={'person-orb orb-'+i}/><span>{name}</span>{busy===name?<LoaderCircle size={16} className="friends-spin"/>:<ArrowUpRight size={16}/>}</button>)}</div>
      {error&&<p className="friends-error" role="alert">{error}</p>}
    </section>
    <footer className="friends-credit"><span>A prepared Friends universe · Curated photo stories</span><span>Six perspectives. One shared history.</span></footer>
  </main>
}
