import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, Check, LoaderCircle, UserPlus, X } from 'lucide-react'
import type { DiscoverableUser, PersonalityType, PlanetArchetype, ProfileIntakePayload } from '../../product/contracts'
import { apiClient } from '../../product/api/apiClient'
import { useI18n } from '../../product/i18n'
import { useProductStore } from '../../product/store/useProductStore'
import { CreationRitual } from '../genesis/CreationRitual'
import { PlanetPreview } from '../planet/PlanetPreview'
import { authoredWorldLibrary } from '../planet/authoredWorldLibrary'
import { GuidedProfileForm } from './GuidedProfileForm'
import { GUIDED_PROFILE_FIELDS } from './guidedProfileFields'
import { PersonalitySelector } from './PersonalitySelector'
import { PlanetChooser } from './PlanetChooser'
import { ProfileCoordinateJourney } from './ProfileCoordinateJourney'
import { UniverseTextPrelude } from './UniverseTextPrelude'
import { createPersonalityPlanetOptions, getPersonality } from './personalityCatalog'
import { getEvidenceAdjustedAffinity } from '../relationships/profileAffinity'
import {
  EMPTY_GUIDED_PROFILE,
  type GuidedProfileDraft,
  type GuidedProfileField,
} from './profileDistanceModel'
import type { OnboardingModuleProps, OnboardingStep } from './types'
import styles from './OnboardingFlow.module.css'

const steps: OnboardingStep[] = ['personality', 'planet', 'profile', 'matching', 'review']
const stepNames = {
  personality: { zh: 'Personality', en: 'Personality' },
  planet: { zh: 'World', en: 'World' },
  profile: { zh: 'Coordinates', en: 'Coordinates' },
  matching: { zh: 'Matching', en: 'Matching' },
  review: { zh: 'Launch', en: 'Launch' },
}

function tagsFromInput(value: string): string[] {
  return value.split(/[,，、;；\n]+/).map((tag) => tag.trim()).filter(Boolean).slice(0, 12)
}

const fallbackPersonalityByArchetype: Record<PlanetArchetype, PersonalityType> = {
  crystalline: 'INTJ',
  volcanic: 'ENTP',
  verdant: 'INFP',
  oceanic: 'ISFP',
  terran: 'ISTJ',
}

export function OnboardingFlow({ mode = 'create', initialStep, onClose, onSaved }: OnboardingModuleProps = {}) {
  const { isZh } = useI18n()
  const editing = mode === 'edit'
  const profile = useProductStore((state) => state.profile)
  const selfPlanet = useProductStore((state) => state.selfPlanet)
  const draftIdentity = useProductStore((state) => state.draftIdentity)
  const draftVisual = useProductStore((state) => state.draftVisual)
  const updateProfile = useProductStore((state) => state.updateProfile)
  const updateDraftIdentity = useProductStore((state) => state.updateDraftIdentity)
  const setDraftVisual = useProductStore((state) => state.setDraftVisual)
  const updateDraftVisual = useProductStore((state) => state.updateDraftVisual)
  const completeGenesis = useProductStore((state) => state.completeGenesis)
  const createRelationship = useProductStore((state) => state.createRelationship)
  const hydrateCosmos = useProductStore((state) => state.hydrateCosmos)
  const signOut = useProductStore((state) => state.signOut)

  const [step, setStep] = useState<OnboardingStep>(initialStep ?? (editing ? 'profile' : 'personality'))
  const [personality, setPersonality] = useState<PersonalityType | null>(() => (
    editing ? fallbackPersonalityByArchetype[draftVisual.archetype] : null
  ))
  const [displayName, setDisplayName] = useState(profile?.displayName ?? '')
  const [existingIntake, setExistingIntake] = useState<ProfileIntakePayload | null>(null)
  const [profileDraft, setProfileDraft] = useState<GuidedProfileDraft>(EMPTY_GUIDED_PROFILE)
  const [fieldIndex, setFieldIndex] = useState(0)
  const [discoverablePeople, setDiscoverablePeople] = useState<DiscoverableUser[]>([])
  const [discoveryLoading, setDiscoveryLoading] = useState(false)
  const [connectingUserId, setConnectingUserId] = useState('')
  const [connectedUserIds, setConnectedUserIds] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [massScore, setMassScore] = useState<number | null>(null)
  const [returningToAuth, setReturningToAuth] = useState(false)
  const [creationStage, setCreationStage] = useState<'idle' | 'ritual' | 'prelude'>('idle')
  const hydratedRef = useRef(false)

  useEffect(() => {
    if (!profile || hydratedRef.current) return
    hydratedRef.current = true
    let active = true
    apiClient.getProfileIntake()
      .then((intake) => {
        if (!active) return
        setExistingIntake(intake)
        const highSchool = intake.education?.find((item) => item.level === 'secondary')
        const university = intake.education?.find((item) => item.level !== 'secondary')
        const nextDraft: GuidedProfileDraft = {
          highSchool: highSchool?.institution ?? '',
          university: university?.institution ?? '',
          major: university?.fieldOfStudy ?? '',
          city: intake.residences?.[0]?.place.name ?? '',
          hometown: intake.birthPlace?.name ?? '',
          interests: intake.interests?.map((item) => item.name).join('，') ?? profile.tags.join('，'),
          skills: intake.skills?.map((item) => item.name).join('，') ?? '',
          projectDirection: intake.projects?.[0]?.description ?? '',
          bio: intake.bio ?? profile.bio,
        }
        setProfileDraft(nextDraft)
        if (intake.personalityType) {
          setPersonality(intake.personalityType)
          if (!draftIdentity.name.trim()) {
            const definition = getPersonality(intake.personalityType)
            updateDraftIdentity({
              name: isZh ? `${profile.displayName}'s World` : `${profile.displayName}'s World`,
              motto: isZh ? definition.motto.zh : definition.motto.en,
            })
            setDraftVisual(createPersonalityPlanetOptions(intake.personalityType)[0].visual)
          }
        }
      })
      .catch((cause) => {
        if (active) setSaveError(cause instanceof Error ? cause.message : (isZh ? 'Unable to load profile draft' : 'Unable to load profile draft'))
      })
    return () => { active = false }
  }, [draftIdentity.name, isZh, profile, setDraftVisual, updateDraftIdentity])

  const stepIndex = steps.indexOf(step)
  const answeredCount = Object.values(profileDraft).filter((value) => value.trim()).length
  const selectedAuthoredWorld = authoredWorldLibrary.findByAssetUrl(draftVisual.externalAssetUrl)
  const previewMeta = selectedAuthoredWorld
    ? `${personality ? `${personality} / ` : ''}AUTHORED / ${isZh ? selectedAuthoredWorld.name.zh : selectedAuthoredWorld.name.en}`
    : `${personality ? `${personality} / ` : ''}${draftVisual.archetype.toUpperCase()} / SEED ${draftVisual.seed}`

  const canContinue = Boolean(profile) && (
    step === 'personality' ? personality !== null
      : step === 'planet' ? draftIdentity.name.trim().length > 1
        : true
  )

  function choosePersonality(type: PersonalityType) {
    setPersonality(type)
    const definition = getPersonality(type)
    const firstOption = createPersonalityPlanetOptions(type)[0]
    setDraftVisual({
      ...firstOption.visual,
      radius: draftVisual.radius,
      backgroundSkinId: draftVisual.backgroundSkinId ?? firstOption.visual.backgroundSkinId,
    })
    updateDraftIdentity({
      name: draftIdentity.name.trim() || (isZh ? `${profile?.displayName ?? ''}'s World` : `${profile?.displayName ?? ''}'s World`),
      motto: isZh ? definition.motto.zh : definition.motto.en,
    })
  }

  function updateProfileField(field: GuidedProfileField, value: string) {
    setProfileDraft((current) => ({ ...current, [field]: value }))
  }

  function buildIntake(): ProfileIntakePayload | null {
    if (!profile || !personality) return null
    const interests = tagsFromInput(profileDraft.interests)
    const skills = tagsFromInput(profileDraft.skills)
    const base = existingIntake ?? { displayName: displayName.trim() || profile.displayName }
    const existingEducation = base.education ?? []
    const highSchoolIndex = existingEducation.findIndex((item) => item.level === 'secondary')
    const universityIndex = existingEducation.findIndex((item) => item.level !== 'secondary')
    const education = [...existingEducation]
    if (profileDraft.highSchool.trim()) {
      const previous = highSchoolIndex >= 0 ? education[highSchoolIndex] : null
      const value = { ...previous, institution: profileDraft.highSchool.trim(), level: 'secondary' as const, fieldOfStudy: previous?.fieldOfStudy ?? '', period: previous?.period ?? {} }
      if (highSchoolIndex >= 0) education[highSchoolIndex] = value
      else education.push(value)
    }
    if (profileDraft.university.trim()) {
      const previous = universityIndex >= 0 ? education[universityIndex] : null
      const value = { ...previous, institution: profileDraft.university.trim(), level: previous?.level ?? ('bachelor' as const), fieldOfStudy: profileDraft.major.trim(), period: previous?.period ?? {} }
      if (universityIndex >= 0) education[universityIndex] = value
      else education.push(value)
    }
    const projects = [...(base.projects ?? [])]
    if (profileDraft.projectDirection.trim()) {
      const projectIndex = projects.findIndex((item) => item.kind === 'current-direction')
      const value = {
        ...(projectIndex >= 0 ? projects[projectIndex] : {}),
        title: isZh ? 'Current build direction' : 'Current build direction',
        kind: 'current-direction',
        description: profileDraft.projectDirection.trim(),
        period: projectIndex >= 0 ? projects[projectIndex].period : { isCurrent: true },
      }
      if (projectIndex >= 0) projects[projectIndex] = value
      else projects.push(value)
    }
    const guideAttribute = {
      key: 'onboarding.profile_guide_completed',
      label: isZh ? 'Profile guide completed' : 'Profile guide completed',
      category: 'onboarding',
      value: true,
      visibility: 'private' as const,
    }
    return {
      ...base,
      displayName: displayName.trim() || profile.displayName,
      bio: profileDraft.bio.trim(),
      personalityType: personality,
      birthPlace: profileDraft.hometown.trim() ? { ...(base.birthPlace ?? {}), name: profileDraft.hometown.trim() } : base.birthPlace,
      residences: profileDraft.city.trim()
        ? [{ ...(base.residences?.[0] ?? {}), place: { ...(base.residences?.[0]?.place ?? {}), name: profileDraft.city.trim() }, period: base.residences?.[0]?.period ?? { isCurrent: true } }, ...(base.residences?.slice(1) ?? [])]
        : (base.residences ?? []),
      education,
      projects,
      skills: skills.length ? skills.map((name) => ({ name, proficiency: 3 })) : (base.skills ?? []),
      interests: interests.length ? interests.map((name) => ({ name })) : (base.interests ?? []),
      attributes: [...(base.attributes ?? []).filter((item) => item.key !== guideAttribute.key), guideAttribute],
    }
  }

  async function saveProfileIntake(): Promise<boolean> {
    const intake = buildIntake()
    if (!intake) return false
    setSaving(true)
    setSaveError('')
    try {
      const result = await apiClient.saveProfileIntake(intake)
      const tags = result.profile.tags.length ? result.profile.tags : tagsFromInput(profileDraft.interests)
      setMassScore(result.planetScore.massScore)
      updateProfile({ ...result.profile, tags })
      updateDraftIdentity({
        description: result.profile.bio,
        tags,
        mass: result.planetScore.physicalMass,
        influence: Math.round(result.planetScore.massScore),
      })
      updateDraftVisual({ radius: result.planetScore.visualRadius })
      return true
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : (isZh ? 'Profile could not be saved' : 'Profile could not be saved'))
      return false
    } finally {
      setSaving(false)
    }
  }

  async function goNext() {
    if (!canContinue) return
    if (step === 'personality') setStep('planet')
    else if (step === 'planet') {
      if (editing) setStep('profile')
      else setCreationStage('ritual')
    }
    else if (step === 'matching') setStep('review')
    else if (step === 'review') {
      if (editing) {
        if (!(await saveProfileIntake())) return
        setSaving(true)
        setSaveError('')
        try {
          const state = useProductStore.getState()
          await apiClient.createPlanet(state.draftIdentity, state.draftVisual)
          const cosmos = await apiClient.getCosmos()
          hydrateCosmos(cosmos)
          onSaved?.()
          onClose?.()
        } catch (cause) {
          setSaveError(cause instanceof Error ? cause.message : (isZh ? 'Unable to save world changes' : 'Unable to save world changes'))
        } finally {
          setSaving(false)
        }
      } else {
        setSaving(true)
        setSaveError('')
        try {
          await completeGenesis()
        } catch (cause) {
          setSaveError(cause instanceof Error ? cause.message : (isZh ? 'Unable to enter the cosmos right now' : 'Unable to enter the cosmos right now'))
        } finally {
          setSaving(false)
        }
      }
    }
  }

  function closeEditor() {
    if (selfPlanet) {
      updateDraftIdentity(selfPlanet.identity)
      setDraftVisual(selfPlanet.visual)
    }
    onClose?.()
  }

  async function returnToAuth() {
    if (returningToAuth) return
    setReturningToAuth(true)
    try {
      await signOut()
    } finally {
      setReturningToAuth(false)
    }
  }

  function goBack() {
    if (step === 'profile' && fieldIndex > 0) {
      setFieldIndex((value) => value - 1)
      return
    }
    if (stepIndex > 0) setStep(steps[stepIndex - 1])
  }

  async function advanceProfileField() {
    if (fieldIndex < GUIDED_PROFILE_FIELDS.length - 1) {
      setFieldIndex((value) => value + 1)
      return
    }
    if (await saveProfileIntake()) {
      setDiscoveryLoading(true)
      try {
        const result = await apiClient.discoverUsers(true)
        setDiscoverablePeople(result.users)
      } catch (cause) {
        setSaveError(cause instanceof Error ? cause.message : 'Could not calculate the profile similarity.')
      } finally {
        setDiscoveryLoading(false)
      }
      setStep('matching')
    }
  }

  function skipProfileField() {
    const field = GUIDED_PROFILE_FIELDS[fieldIndex]
    updateProfileField(field.id, '')
    void advanceProfileField()
  }

  async function connectRealUser(person: DiscoverableUser) {
    if (connectingUserId || connectedUserIds.includes(person.id)) return
    setConnectingUserId(person.id)
    setSaveError('')
    try {
      await createRelationship({
        targetUserId: person.id,
        relationType: 'friend',
        identityLabel: isZh ? 'New friend' : 'New friend',
        description: isZh ? 'Connected through world discovery.' : 'Connected through world discovery.',
        status: 'active',
        startedAt: null,
      })
      setConnectedUserIds((current) => [...current, person.id])
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : (isZh ? 'Could not connect right now. Please try again.' : 'Could not connect right now. Please try again.'))
    } finally {
      setConnectingUserId('')
    }
  }

  if (!profile) return null

  if (creationStage === 'ritual') {
    return (
      <CreationRitual
        config={draftVisual}
        planetName={draftIdentity.name}
        onComplete={() => setCreationStage('prelude')}
      />
    )
  }

  if (creationStage === 'prelude') {
    return (
      <UniverseTextPrelude
        isZh={isZh}
        onComplete={() => {
          setCreationStage('idle')
          setStep('profile')
        }}
      />
    )
  }

  if (!editing && step === 'profile') {
    return (
      <ProfileCoordinateJourney
        visual={draftVisual}
        planetName={draftIdentity.name}
        draft={profileDraft}
        fieldIndex={fieldIndex}
        isZh={isZh}
        saving={saving}
        error={saveError}
        onChange={updateProfileField}
        onBack={() => {
          if (fieldIndex > 0) setFieldIndex((value) => value - 1)
          else setStep('planet')
        }}
        onAdvance={() => void advanceProfileField()}
        onSkip={skipProfileField}
      />
    )
  }

  return (
    <main className={`${styles.screen} ${editing ? styles.editing : ''}`} data-onboarding-shell>
      <header className={styles.header}>
        <div className={styles.brand}><i />{editing ? (isZh ? 'EDIT MY COSMOS' : 'EDIT MY COSMOS') : 'SOCIAL COSMOS'}</div>
        <nav className={styles.progress} aria-label={isZh ? 'Onboarding progress' : 'Onboarding progress'}>
          {steps.map((item, index) => (
            <button
              type="button"
              key={item}
              className={index <= stepIndex ? styles.progressActive : styles.progressItem}
              disabled={!editing}
              onClick={() => editing && setStep(item)}
            >
              <span>{index < stepIndex ? <Check size={12} /> : index + 1}</span>
              <small>{isZh ? stepNames[item].zh : stepNames[item].en}</small>
            </button>
          ))}
        </nav>
        {editing ? (
          <button type="button" className={styles.closeEditor} onClick={closeEditor} title={isZh ? 'Close editor' : 'Close editor'} aria-label={isZh ? 'Close editor' : 'Close editor'}>
            <X size={18} />
          </button>
        ) : (
          <button
            type="button"
            className={styles.returnToAuth}
            onClick={() => void returnToAuth()}
            disabled={returningToAuth}
            title={isZh ? 'Return to sign up or sign in' : 'Return to sign up or sign in'}
            aria-label={isZh ? 'Return to sign up or sign in' : 'Return to sign up or sign in'}
          >
            {returningToAuth ? <LoaderCircle className={styles.spinner} size={16} /> : <ArrowLeft size={16} />}
            <span>{isZh ? 'Back to sign in' : 'Back to sign in'}</span>
          </button>
        )}
      </header>

      <section className={styles.workspace}>
        <div className={styles.controls}>
          {step === 'personality' && (
            <>
              <div className={styles.heading}>
                <span>{isZh ? 'YOUR FIRST SIGNAL' : 'YOUR FIRST SIGNAL'}</span>
                <h1>{isZh ? 'Choose the pattern closest to who you are now' : 'Choose the pattern closest to who you are now'}</h1>
                <p>{isZh ? 'This only seeds your first world candidates. It never permanently defines you, and can be changed later.' : 'This only seeds your first world candidates. It never permanently defines you, and can be changed later.'}</p>
              </div>
              <PersonalitySelector selected={personality} isZh={isZh} onSelect={choosePersonality} />
            </>
          )}

          {step === 'planet' && personality && (
            <>
              <div className={styles.heading}>
                <span>{isZh ? 'WORLD INCUBATOR' : 'WORLD INCUBATOR'}</span>
                <h1>{isZh ? 'Choose your first world' : 'Choose your first world'}</h1>
                <p>{isZh ? 'Start from a personality resonance or depart completely. Every visual parameter is structured for future API, model, or asset customization.' : 'Start from a personality resonance or depart completely. Every visual parameter is structured for future API, model, or asset customization.'}</p>
              </div>
              <PlanetChooser
                personality={personality}
                visual={draftVisual}
                planetName={draftIdentity.name}
                isZh={isZh}
                onPlanetNameChange={(name) => updateDraftIdentity({ name })}
                onVisualChange={setDraftVisual}
                onVisualPatch={updateDraftVisual}
              />
            </>
          )}

          {step === 'matching' && (
            <>
              <div className={styles.heading}>
                <span>{isZh ? 'DATABASE AFFINITY' : 'DATABASE AFFINITY'}</span>
                <h1>{isZh ? 'These are not subjective closeness scores' : 'These are not subjective closeness scores'}</h1>
                <p>{isZh ? 'These are real database users ranked from the facts you just saved: location, school, field, interests, experience, and personality. Connect now or skip and decide after entering the universe.' : 'These are real database users ranked from the facts you just saved: location, school, field, interests, experience, and personality. Connect now or skip and decide after entering the universe.'}</p>
              </div>
              <article className={styles.relationshipStory}>
                {discoveryLoading && <div className={styles.savingLine}><LoaderCircle size={14} />{isZh ? 'Calculating objective affinity…' : 'Calculating objective affinity…'}</div>}
                {!discoveryLoading && discoverablePeople.slice(0, 6).map((person) => {
                  const adjustedAffinity = getEvidenceAdjustedAffinity(person)
                  return <div key={person.id} className={styles.discoveryCandidate}>
                    <span className={styles.discoveryAvatar}>{person.displayName.slice(0, 1).toUpperCase()}</span>
                    <span className={styles.discoveryCopy}>
                      <strong>{person.displayName} · {person.planetName}</strong>
                      <small>{person.profileFeatures?.slice(0, 3).map((feature) => feature.name.replaceAll('_', ' ')).join(' · ') || (isZh ? 'Not enough profile evidence yet' : 'Not enough profile evidence yet')}</small>
                    </span>
                    <b>{adjustedAffinity === null ? '—' : `${Math.round(adjustedAffinity * 100)}%`}</b>
                    <button
                      type="button"
                      onClick={() => void connectRealUser(person)}
                      disabled={Boolean(connectingUserId) || connectedUserIds.includes(person.id)}
                    >
                      {connectingUserId === person.id
                        ? <LoaderCircle size={14} className={styles.spinner} />
                        : connectedUserIds.includes(person.id)
                          ? <Check size={14} />
                          : <UserPlus size={14} />}
                      {connectedUserIds.includes(person.id)
                        ? (isZh ? 'Connected' : 'Connected')
                        : (isZh ? 'Connect' : 'Connect')}
                    </button>
                  </div>
                })}
                {!discoveryLoading && discoverablePeople.length === 0 && <p>{isZh ? 'No other database users are available yet.' : 'No other database users are available yet.'}</p>}
                <small className={styles.privacyNote}>{isZh ? 'No fictional people are created here. Only real accounts you choose to connect enter your galaxy.' : 'No fictional people are created here. Only real accounts you choose to connect enter your galaxy.'}</small>
                {saveError && <p className={styles.error}>{saveError}</p>}
              </article>
            </>
          )}

          {editing && step === 'profile' && (
            <>
              <div className={styles.headingCompact}>
                <span>{isZh ? 'LET YOUR COORDINATES EMERGE' : 'LET YOUR COORDINATES EMERGE'}</span>
                <p>{isZh ? 'Every question is optional. Saved profile facts update your mass and coordinates, then support real-user discovery from the database.' : 'Every question is optional. Saved profile facts update your mass and coordinates, then support real-user discovery from the database.'}</p>
              </div>
              <label className={styles.inputLabel}>
                {isZh ? 'Display name' : 'Display name'}
                <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} maxLength={80} />
              </label>
              <GuidedProfileForm draft={profileDraft} fieldIndex={fieldIndex} isZh={isZh} onChange={updateProfileField} onBack={goBack} onAdvance={() => void advanceProfileField()} onSkip={skipProfileField} />
              {saveError && <p className={styles.error}>{saveError}</p>}
              {saving && <div className={styles.savingLine}><LoaderCircle size={14} />{isZh ? 'Saving your coordinates…' : 'Saving your coordinates…'}</div>}
            </>
          )}

          {step === 'review' && personality && (
            <>
              <div className={styles.heading}>
                <span>{isZh ? 'ENTER THE LIVING COSMOS' : 'ENTER THE LIVING COSMOS'}</span>
                <h1>{isZh ? 'Your world and its first coordinates are ready' : 'Your world and its first coordinates are ready'}</h1>
                <p>{isZh ? 'Your world has already passed through genesis. Save these real coordinates and enter the social cosmos.' : 'Your world has already passed through genesis. Save these real coordinates and enter the social cosmos.'}</p>
              </div>
              <div className={styles.reviewHero}>
                <span>{personality} · {isZh ? getPersonality(personality).name.zh : getPersonality(personality).name.en}</span>
                <strong>{draftIdentity.name}</strong>
                <p>“{draftIdentity.motto}”</p>
              </div>
              <div className={styles.summary}>
                <div><span>{isZh ? 'Coordinates shared' : 'Coordinates shared'}</span><strong>{answeredCount} / {GUIDED_PROFILE_FIELDS.length}</strong></div>
                <div><span>{isZh ? 'Mass score' : 'Mass score'}</span><strong>{massScore === null ? '—' : massScore.toFixed(1)}</strong></div>
                <div>
                  <span>{selectedAuthoredWorld ? (isZh ? 'Authored world' : 'Authored world') : (isZh ? 'Terrain' : 'Terrain')}</span>
                  <strong>{selectedAuthoredWorld ? (isZh ? selectedAuthoredWorld.name.zh : selectedAuthoredWorld.name.en) : draftVisual.archetype}</strong>
                </div>
                <div>
                  <span>{selectedAuthoredWorld ? (isZh ? 'Model source' : 'Model source') : (isZh ? 'World seed' : 'World seed')}</span>
                  <strong>{selectedAuthoredWorld ? 'SC 3D MODEL' : draftVisual.seed}</strong>
                </div>
              </div>
              {saveError && <p className={styles.error}>{saveError}</p>}
            </>
          )}

          {step !== 'profile' && (
            <footer className={styles.footer}>
              <button type="button" className={styles.back} onClick={goBack} disabled={stepIndex === 0} title={isZh ? 'Previous step' : 'Previous step'}><ArrowLeft size={17} />{isZh ? 'Previous' : 'Previous'}</button>
              <span>{isZh ? `Step ${stepIndex + 1} of ${steps.length}` : `Step ${stepIndex + 1} of ${steps.length}`}</span>
              <button type="button" className={styles.next} onClick={() => void goNext()} disabled={!canContinue || saving}>
                {saving
                  ? (isZh ? 'Saving…' : 'Saving…')
                  : step === 'review'
                    ? editing ? (isZh ? 'Save all changes' : 'Save all changes') : (isZh ? 'Save and enter the cosmos' : 'Save and enter the cosmos')
                    : step === 'matching'
                      ? (isZh ? 'Finish / skip for now' : 'Finish / skip for now')
                      : (isZh ? 'Continue' : 'Continue')}
                {saving ? <LoaderCircle className={styles.spinner} size={16} /> : <ArrowRight size={17} />}
              </button>
            </footer>
          )}
        </div>

        <div className={styles.preview}>
          <PlanetPreview config={draftVisual} />
          {step !== 'profile' && (
            <div className={styles.previewCaption}>
              <span>{previewMeta}</span>
              <strong>{step === 'personality' && !personality ? (isZh ? 'AWAITING SIGNAL' : 'AWAITING SIGNAL') : draftIdentity.name}</strong>
              <p>{personality ? draftIdentity.motto : (isZh ? 'Choose a personality to shift terrain and spectrum' : 'Choose a personality to shift terrain and spectrum')}</p>
            </div>
          )}
        </div>
      </section>
    </main>
  )
}
