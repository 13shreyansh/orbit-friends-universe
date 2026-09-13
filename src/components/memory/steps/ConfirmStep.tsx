import { useState } from 'react'
import { useAddMemoryStore } from '../../../store/useAddMemoryStore'
import { usePeopleStore } from '../../../store/usePeopleStore'
import { useMemoriesStore } from '../../../store/useMemoriesStore'
import { useSceneStore } from '../../../store/useSceneStore'
import { RELATIONSHIP_CHANGE_LABELS } from '../../../constants/relationshipChangeEffects'
import { getIntimacyForOrbitRadius, getOrbitRadius, getPlanetRadius } from '../../../utils/relationshipVisuals'
import {
  buildOccupiedSpheresFromPeople,
  findNonOverlappingPosition,
  getCoreOccupiedSphere,
} from '../../../utils/spherePlacement'
import { SPHERE_LAYOUT_CONFIG } from '../../../constants/sphereLayoutConfig'
import type { RelationshipChange, SemanticInteractionType } from '../../../types/memoryObject'
import type { Person } from '../../../types/person'
import { apiClient } from '../../../product/api/apiClient'
import { useProductStore } from '../../../product/store/useProductStore'
import styles from './ConfirmStep.module.css'

/** Narrative starting point for a brand-new connection — a fresh
 * acquaintance, not yet close. The actual stored intimacy may end up
 * slightly different from what this alone would produce, only if the
 * collision search below has to nudge the orbit radius to find room. */
const NEW_CONTACT_BASE_INTIMACY = 28
const NEW_CONTACT_BASE_FREQUENCY = 22
/** memoryCount to size the new planet against — this first memory is
 * attached in the same commit that creates the person (see
 * commitToUniverse below), so placing collision-checks against the size
 * it will actually render at (not 0) avoids a subtly-too-tight gap. */
const NEW_CONTACT_INITIAL_MEMORY_COUNT = 1

const RELATIONSHIP_CHANGE_OPTIONS: RelationshipChange[] = [
  'closer',
  'stable',
  'distant',
  'reconnected',
  'conflict',
]

const SEMANTIC_INTERACTION_LABELS: Record<SemanticInteractionType, string> = {
  mention: 'Mention',
  conversation: 'Conversation',
  co_presence: 'Time together',
  shared_activity: 'Shared activity',
  collaboration: 'Collaboration',
  support: 'Support',
  milestone: 'Shared milestone',
  reconnection: 'Reconnection',
  conflict: 'Conflict',
  other: 'Other',
}

const SEMANTIC_DIRECTION_LABELS = {
  mutual: 'Mutual',
  outgoing: 'Started by me',
  incoming: 'Started by them',
  unknown: 'Initiator unknown',
} as const

function initialsFor(name: string): string {
  return name
    .split(' ')
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()
}

/** Synthesizes a full Person record for someone the AI identified who isn't
 * in the universe yet, placed via a collision-aware search (see
 * spherePlacement.ts) so a brand new star never spawns overlapping an
 * existing planet or the core — starting deliberately distant/dim, since
 * this is a fresh connection, not an established one. */
function createPersonFromDraft(id: string, name: string, eventTime: string): Person {
  const { people, maxMemoryCount } = usePeopleStore.getState()

  const newRadius = getPlanetRadius(NEW_CONTACT_INITIAL_MEMORY_COUNT, maxMemoryCount)
  const existingSpheres = [
    getCoreOccupiedSphere(),
    ...buildOccupiedSpheresFromPeople(people, maxMemoryCount),
  ]

  const placement = findNonOverlappingPosition({
    newRadius,
    existingSpheres,
    preferredOrbitRadius: getOrbitRadius(NEW_CONTACT_BASE_INTIMACY),
    safetyGap: SPHERE_LAYOUT_CONFIG.defaultSafetyGap,
  })

  return {
    id,
    name,
    relationType: 'friend',
    // Only differs from NEW_CONTACT_BASE_INTIMACY if the collision search
    // had to nudge the orbit radius outward/inward to find room — the
    // narrative "fresh connection" feel is preserved either way since the
    // adjustment is always small relative to the full 0-100 range.
    intimacy: getIntimacyForOrbitRadius(placement.orbitRadius),
    interactionFrequency: NEW_CONTACT_BASE_FREQUENCY,
    memoryCount: 0,
    position: { angle: placement.angleDeg, elevation: placement.elevation },
    shortDescription: 'A new connection, just beginning.',
    avatar: initialsFor(name),
    lastInteraction: eventTime,
    status: 'active',
  }
}

export function ConfirmStep() {
  const draft = useAddMemoryStore((state) => state.draft)
  const draftReference = useAddMemoryStore((state) => state.draftReference)
  const updateDraft = useAddMemoryStore((state) => state.updateDraft)
  const backToInput = useAddMemoryStore((state) => state.backToInput)
  const discardDraft = useAddMemoryStore((state) => state.discardDraft)
  const closeDrawer = useAddMemoryStore((state) => state.closeDrawer)
  const triggerToast = useAddMemoryStore((state) => state.triggerToast)
  const notifyMemoryChanged = useAddMemoryStore((state) => state.notifyMemoryChanged)
  const relationshipContext = useAddMemoryStore((state) => state.relationshipContext)

  const addMemoryToPerson = usePeopleStore((state) => state.addMemoryToPerson)
  const addNewPerson = usePeopleStore((state) => state.addNewPerson)
  const addMemoryObject = useMemoriesStore((state) => state.addMemoryObject)
  const selectPerson = useSceneStore((state) => state.selectPerson)
  const relationships = useProductStore((state) => state.relationships)
  const hydrateCosmos = useProductStore((state) => state.hydrateCosmos)

  const [showNewPersonConfirm, setShowNewPersonConfirm] = useState(false)
  const [isSaving, setIsSaving] = useState(false)

  if (!draft) return null

  const contextualPerson = relationshipContext
    ? {
        id: relationshipContext.targetUserId,
        name: relationshipContext.targetName,
        isExisting: true,
      }
    : null
  const memoryToPersist = contextualPerson ? { ...draft, people: [contextualPerson] } : draft
  const newPeople = memoryToPersist.people.filter((person) => !person.isExisting)

  const handlePersonNameChange = (index: number, name: string) => {
    const people = draft.people.map((person, i) => (i === index ? { ...person, name } : person))
    updateDraft({ people })
  }

  const commitToUniverse = async () => {
    if (isSaving) return
    setIsSaving(true)
    let newlyBornPersonId: string | null = null
    const existingPerson = memoryToPersist.people.find((person) => person.isExisting)
    const relationship = relationshipContext
      ? relationships.find((item) => item.id === relationshipContext.relationshipId)
      : relationships.find((item) => item.targetUserId === existingPerson?.id)
    let persistedMemory: typeof draft
    try {
      const result = draftReference
        ? await apiClient.confirmMemoryDraft(
            draftReference.id,
            draftReference.version,
            memoryToPersist,
            relationship?.id,
          )
        : await apiClient.saveMemory(memoryToPersist, relationship?.id)
      persistedMemory = result.memory
      hydrateCosmos(result.cosmos)
    } catch (cause) {
      console.error('Memory persistence failed:', cause)
      triggerToast('Could not save the memory. Your changes are still here.')
      setIsSaving(false)
      return
    }
    for (const personRef of persistedMemory.people) {
      if (!personRef.isExisting) {
        addNewPerson(createPersonFromDraft(personRef.id, personRef.name, persistedMemory.eventTime))
        newlyBornPersonId = personRef.id
      }
      addMemoryToPerson(personRef.id, persistedMemory)
      addMemoryObject(personRef.id, persistedMemory)
    }
    triggerToast('This memory is now a new star in your shared story.')
    notifyMemoryChanged()
    closeDrawer()
    // A brand-new star is tiny and far from the default establishing shot —
    // fly the camera to it so its arrival is actually witnessed instead of
    // landing unnoticed somewhere in the background star field.
    if (newlyBornPersonId) selectPerson(newlyBornPersonId)
  }

  const handleAddToUniverse = () => {
    if (newPeople.length > 0 && !showNewPersonConfirm) {
      setShowNewPersonConfirm(true)
      return
    }
    void commitToUniverse()
  }

  const handleBackToInput = async () => {
    if (!await discardDraft()) return
    backToInput()
  }

  if (showNewPersonConfirm) {
    return (
      <div className={styles.wrapper}>
        <div className={styles.newPersonPrompt}>
          <p className={styles.newPersonTitle}>New person found</p>
          {newPeople.map((person) => (
            <p key={person.id} className={styles.newPersonName}>
              {person.name}
            </p>
          ))}
          <p className={styles.newPersonQuestion}>Add this person to your universe?</p>
          <div className={styles.newPersonActions}>
            <button
              type="button"
              className={styles.secondaryButton}
              disabled={isSaving}
              onClick={() => setShowNewPersonConfirm(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              className={styles.primaryButton}
              disabled={isSaving}
              onClick={() => void commitToUniverse()}
            >
              {isSaving ? 'Saving…' : 'Add to universe'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.wrapper}>
      <section className={styles.section}>
        <span className={styles.sectionLabel}>People found</span>
        {relationshipContext && (
          <p className={styles.readonlyText}>This memory will be saved to your story with {relationshipContext.targetName}.</p>
        )}
        {(relationshipContext ? memoryToPersist.people : draft.people).map((person, index) => (
          <div key={person.id} className={styles.personRow}>
            <input
              type="text"
              className={styles.textInput}
              value={person.name}
              readOnly={Boolean(relationshipContext)}
              onChange={(event) => handlePersonNameChange(index, event.target.value)}
            />
            {!person.isExisting && <span className={styles.newBadge}>New person</span>}
          </div>
        ))}
      </section>

      <section className={styles.section}>
        <span className={styles.sectionLabel}>Date</span>
        <input
          type="date"
          className={styles.textInput}
          value={draft.eventTime}
          onChange={(event) => updateDraft({ eventTime: event.target.value })}
        />
      </section>

      <section className={styles.section}>
        <span className={styles.sectionLabel}>Place</span>
        <p className={styles.readonlyText}>{draft.location}</p>
      </section>

      <section className={styles.section}>
        <span className={styles.sectionLabel}>What happened</span>
        <textarea
          className={styles.textarea}
          rows={3}
          value={draft.summary}
          onChange={(event) => updateDraft({ summary: event.target.value })}
        />
      </section>

      {draft.media && draft.media.length > 0 && (
        <section className={styles.section}>
          <span className={styles.sectionLabel}>Media to save in Memory Book</span>
          <div className={styles.mediaPreviewGrid}>
            {draft.media.map((media) => (
              <figure key={media.url} className={styles.mediaPreview}>
                {media.type === 'video' ? (
                  <video src={media.url} controls muted playsInline preload="metadata" />
                ) : (
                  <img src={media.url} alt={media.name} />
                )}
                <figcaption>{media.name}</figcaption>
              </figure>
            ))}
          </div>
        </section>
      )}

      {draft.semanticEvidence && (
        <section className={styles.section}>
          <span className={styles.sectionLabel}>Memory context</span>
          <p className={styles.readonlyText}>
            {SEMANTIC_INTERACTION_LABELS[draft.semanticEvidence.interactionType]}
            {' · '}{draft.semanticEvidence.participation === 'direct' ? 'Directly involved' : 'Mentioned indirectly'}
            {' · '}{SEMANTIC_DIRECTION_LABELS[draft.semanticEvidence.direction]}
            {' · '}Confidence {Math.round(draft.semanticEvidence.confidence * 100)}%
          </p>
          <div className={styles.emotionRow}>
            {draft.semanticEvidence.evidenceSpans.map((span, index) => (
              <span key={`${index}-${span}`} className={styles.emotionTag}>“{span}”</span>
            ))}
          </div>
        </section>
      )}

      <section className={styles.section}>
        <span className={styles.sectionLabel}>Feelings</span>
        <div className={styles.emotionRow}>
          {draft.emotions.map((emotion) => (
            <span key={emotion.name} className={styles.emotionTag}>
              {emotion.name} · {emotion.intensity}
            </span>
          ))}
        </div>
      </section>

      <section className={styles.section}>
        <span className={styles.sectionLabel}>Connection changes</span>
        <select
          className={styles.select}
          value={draft.relationshipSignals.relationshipChange}
          onChange={(event) =>
            updateDraft({
              relationshipSignals: {
                ...draft.relationshipSignals,
                relationshipChange: event.target.value as RelationshipChange,
              },
            })
          }
        >
          {RELATIONSHIP_CHANGE_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {RELATIONSHIP_CHANGE_LABELS[option]}
            </option>
          ))}
        </select>
      </section>

      <section className={styles.section}>
        <span className={styles.sectionLabel}>The story of this memory</span>
        <p className={styles.narrative}>"{draft.narrative}"</p>
      </section>

      <div className={styles.actions}>
        <button type="button" className={styles.secondaryButton} disabled={isSaving} onClick={() => void handleBackToInput()}>
          Back to edit
        </button>
        <button
          type="button"
          className={styles.primaryButton}
          disabled={isSaving}
          onClick={handleAddToUniverse}
        >
          {isSaving ? 'Saving…' : 'Add to universe'}
        </button>
      </div>
    </div>
  )
}
