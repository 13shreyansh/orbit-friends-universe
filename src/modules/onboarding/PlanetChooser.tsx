import { Check, RefreshCw, ShieldCheck } from 'lucide-react'
import type { CSSProperties } from 'react'
import type { PersonalityType, PlanetArchetype, PlanetVisualConfig } from '../../product/contracts'
import { PLANET_ARCHETYPES } from '../../product/planetPresets'
import { backgroundSkinModule } from '../background/backgroundSkinModule'
import { AuthoredWorldThumbnail } from '../planet/AuthoredWorldThumbnail'
import { authoredWorldLibrary } from '../planet/authoredWorldLibrary'
import { planetStyleModule } from '../planet/style/planetStyleModule'
import { createPersonalityPlanetOptions, getPersonality } from './personalityCatalog'
import styles from './OnboardingFlow.module.css'

interface PlanetChooserProps {
  personality: PersonalityType
  visual: PlanetVisualConfig
  planetName: string
  isZh: boolean
  onPlanetNameChange: (name: string) => void
  onVisualChange: (visual: PlanetVisualConfig) => void
  onVisualPatch: (values: Partial<PlanetVisualConfig>) => void
}

const archetypeNames: Record<PlanetArchetype, { zh: string; en: string }> = {
  terran: { zh: 'Terran', en: 'Terran' },
  oceanic: { zh: 'Oceanic', en: 'Oceanic' },
  volcanic: { zh: 'Volcanic', en: 'Volcanic' },
  crystalline: { zh: 'Crystal', en: 'Crystal' },
  verdant: { zh: 'Verdant', en: 'Verdant' },
}

export function PlanetChooser({
  personality,
  visual,
  planetName,
  isZh,
  onPlanetNameChange,
  onVisualChange,
  onVisualPatch,
}: PlanetChooserProps) {
  const options = createPersonalityPlanetOptions(personality)
  const personalityInfo = getPersonality(personality)
  const selectedAuthoredWorld = authoredWorldLibrary.findByAssetUrl(visual.externalAssetUrl)
  const selectedBackgroundId = backgroundSkinModule.resolve(visual.backgroundSkinId).id

  function preserveBackground(next: PlanetVisualConfig): PlanetVisualConfig {
    return { ...next, backgroundSkinId: selectedBackgroundId }
  }

  function switchArchetype(archetype: PlanetArchetype) {
    const next = planetStyleModule.generate({
      mode: 'personality',
      archetype,
      seed: visual.seed,
      radius: visual.radius,
      preserve: { satellites: visual.satellites },
    })
    onVisualChange(preserveBackground({
      ...next,
      radius: visual.radius,
      satellites: visual.satellites,
      palette: visual.palette,
      ringColor: visual.palette.highlight,
    }))
  }

  function regenerateWorld() {
    onVisualChange(preserveBackground(planetStyleModule.generate({
      mode: 'system',
      archetype: 'auto',
      seed: planetStyleModule.createSeed(),
      radius: visual.radius,
    })))
  }

  function chooseAuthoredWorld(worldId: string) {
    const next = authoredWorldLibrary.createVisual(worldId, visual.radius)
    if (next) onVisualChange(preserveBackground(next))
  }

  return (
    <div className={styles.planetStudio}>
      <div className={styles.signalBanner} style={{ '--personality-accent': personalityInfo.accent } as CSSProperties}>
        <span>{personality}</span>
        <p>{isZh ? personalityInfo.motto.zh : personalityInfo.motto.en}</p>
      </div>

      <label className={styles.inputLabel}>
        {isZh ? 'Name this world' : 'Name this world'}
        <input
          value={planetName}
          onChange={(event) => onPlanetNameChange(event.target.value)}
          placeholder={isZh ? 'e.g. Liminal Field' : 'e.g. Liminal Field'}
        />
      </label>

      <section className={styles.backgroundStudio} aria-label={isZh ? 'Background skins' : 'Background skins'}>
        <div className={styles.optionHeading}>
          <span>{isZh ? 'BACKGROUND SKIN' : 'BACKGROUND SKIN'}</span>
          <small>{isZh ? 'Saved with your world' : 'Saved with your world'}</small>
        </div>
        <div className={styles.backgroundOptions}>
          {backgroundSkinModule.skins.map((skin) => {
            const active = selectedBackgroundId === skin.id
            return (
              <button
                type="button"
                key={skin.id}
                className={active ? styles.backgroundOptionActive : styles.backgroundOption}
                onClick={() => onVisualPatch({ backgroundSkinId: skin.id })}
                aria-pressed={active}
              >
                <span className={styles.backgroundSwatch} style={{ background: skin.thumbnail }} />
                <span className={styles.backgroundCopy}>
                  <strong>{isZh ? skin.name.zh : skin.name.en}</strong>
                  <small>{isZh ? skin.description.zh : skin.description.en}</small>
                </span>
                {active && <Check size={15} />}
              </button>
            )
          })}
        </div>
      </section>

      <div className={styles.optionHeading}>
        <span>{isZh ? 'WORLD CANDIDATES GENERATED FOR YOU' : 'WORLD CANDIDATES GENERATED FOR YOU'}</span>
        <small>{isZh ? 'Personality is a starting point, not a constraint' : 'Personality is a starting point, not a constraint'}</small>
      </div>
      <div className={styles.planetOptions}>
        {options.map((option) => {
          const active = !selectedAuthoredWorld && option.visual.seed === visual.seed
          return (
            <button
              type="button"
              key={option.id}
              className={active ? styles.planetOptionActive : styles.planetOption}
              onClick={() => onVisualChange(preserveBackground({ ...option.visual, radius: visual.radius }))}
              aria-pressed={active}
            >
              <span className={styles.planetOrb} style={planetStyleModule.thumbnail(option.visual)} />
              <strong>{isZh ? option.name.zh : option.name.en}</strong>
              <small>{isZh ? option.description.zh : option.description.en}</small>
              {active && <Check size={14} />}
            </button>
          )
        })}
      </div>
      <button type="button" className={styles.randomPlanetChoice} onClick={regenerateWorld}>
        <span><RefreshCw size={16} /></span>
        <strong>{isZh ? 'Surprise me with a world' : 'Surprise me with a world'}</strong>
        <small>{isZh ? 'Randomize terrain, spectrum, rings, and moons with the planet generator' : 'Randomize terrain, spectrum, rings, and moons with the planet generator'}</small>
      </button>

      <section className={styles.authoredLibrary}>
        <div className={styles.authoredHeading}>
          <div>
            <span>{isZh ? 'AUTHORED 3D WORLDS' : 'AUTHORED 3D WORLDS'}</span>
            <strong>{isZh ? 'Original model composition, preserved' : 'Original model composition, preserved'}</strong>
          </div>
          <small>{isZh ? 'Separate from the planet generator' : 'Separate from the planet generator'}</small>
        </div>

        <div className={styles.authoredWorlds}>
          {authoredWorldLibrary.worlds.map((world) => {
            const active = selectedAuthoredWorld?.id === world.id
            return (
              <button
                type="button"
                key={world.id}
                className={active ? styles.authoredCardActive : styles.authoredCard}
                onClick={() => chooseAuthoredWorld(world.id)}
                aria-pressed={active}
              >
                <AuthoredWorldThumbnail assetUrl={world.assetUrl} className={styles.authoredPreview} />
                <span className={styles.authoredCopy}>
                  <small>{isZh ? 'ORIGINAL MODEL' : 'ORIGINAL MODEL'}</small>
                  <strong>{isZh ? world.name.zh : world.name.en}</strong>
                  <span>{isZh ? world.description.zh : world.description.en}</span>
                </span>
                {active && <Check className={styles.authoredCheck} size={16} />}
              </button>
            )
          })}
        </div>
      </section>

      {selectedAuthoredWorld ? (
        <div className={styles.authoredNotice}>
          <ShieldCheck size={18} />
          <div>
            <strong>{isZh ? 'Original composition locked' : 'Original composition locked'}</strong>
            <p>
              {isZh
                ? `${selectedAuthoredWorld.name.en} uses its complete GLB model without generated terrain, clouds, rings, or moons.`
                : `${selectedAuthoredWorld.name.en} uses its complete GLB model without generated terrain, clouds, rings, or moons.`}
            </p>
          </div>
        </div>
      ) : (
        <>
          <div className={styles.optionHeading}>
            <span>{isZh ? 'OR CHOOSE ANOTHER GENERATED TERRAIN BASE' : 'OR CHOOSE ANOTHER GENERATED TERRAIN BASE'}</span>
          </div>
          <div className={styles.archetypePills}>
            {PLANET_ARCHETYPES.map((item) => (
              <button
                type="button"
                key={item.id}
                className={visual.archetype === item.id ? styles.archetypePillActive : styles.archetypePill}
                onClick={() => switchArchetype(item.id)}
              >
                <i style={planetStyleModule.thumbnail(planetStyleModule.generate({ mode: 'system', archetype: item.id, seed: 1 }))} />
                {isZh ? archetypeNames[item.id].zh : archetypeNames[item.id].en}
              </button>
            ))}
          </div>

          <div className={styles.sliders}>
            <label>
              <span>{isZh ? 'Terrain relief' : 'Terrain relief'} <b>{Math.round(visual.terrain * 100)}</b></span>
              <input type="range" min="0" max="1" step="0.01" value={visual.terrain} onChange={(event) => onVisualPatch({ terrain: Number(event.target.value) })} />
            </label>
            <label>
              <span>{isZh ? 'Ocean coverage' : 'Ocean coverage'} <b>{Math.round(visual.oceanLevel * 100)}</b></span>
              <input type="range" min="0" max="1" step="0.01" value={visual.oceanLevel} onChange={(event) => onVisualPatch({ oceanLevel: Number(event.target.value) })} />
            </label>
            <label>
              <span>{isZh ? 'Cloud density' : 'Cloud density'} <b>{Math.round(visual.cloudDensity * 100)}</b></span>
              <input type="range" min="0" max="1" step="0.01" value={visual.cloudDensity} onChange={(event) => onVisualPatch({ cloudDensity: Number(event.target.value) })} />
            </label>
          </div>

          <div className={styles.planetToggles}>
            <label><input type="checkbox" checked={visual.ring} onChange={(event) => onVisualPatch({ ring: event.target.checked })} />{isZh ? 'Ring' : 'Ring'}</label>
            <label>{isZh ? 'Moons' : 'Moons'}
              <select value={visual.satellites} onChange={(event) => onVisualPatch({ satellites: Number(event.target.value) })}>
                {[0, 1, 2, 3].map((count) => <option key={count} value={count}>{count}</option>)}
              </select>
            </label>
          </div>
        </>
      )}
    </div>
  )
}
