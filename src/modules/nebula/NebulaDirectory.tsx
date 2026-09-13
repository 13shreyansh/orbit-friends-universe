import { ArrowRight, ChevronLeft, ChevronRight, Compass, Hash, LoaderCircle, Plus, Search, Users, X } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import type { NebulaDirectoryPayload, NebulaSummary } from '../../product/contracts'
import { useI18n } from '../../product/i18n'
import styles from './NebulaDirectory.module.css'

interface NebulaDirectoryProps {
  open: boolean
  directory: NebulaDirectoryPayload
  activeNebulaId: string | null
  loading: boolean
  error: string
  onClose: () => void
  onEnter: (nebulaId: string) => void
  onJoin: (nebulaId: string) => Promise<unknown>
  onJoinByCode: (joinCode: string) => Promise<unknown>
  onCreate: (body: { name: string; description?: string }) => Promise<unknown>
  onSearch: (query: string, page?: number) => Promise<unknown>
}

interface NebulaRowsProps {
  items: NebulaSummary[]
  activeNebulaId: string | null
  onEnter: (nebulaId: string) => void
  onJoin: (nebulaId: string) => Promise<unknown>
}

function NebulaRows({ items, activeNebulaId, onEnter, onJoin }: NebulaRowsProps) {
  const { t } = useI18n()
  return (
    <div className={styles.rows}>
      {items.map((item) => (
        <div className={item.id === activeNebulaId ? styles.activeRow : styles.row} key={item.id}>
          <span className={styles.nebulaMark} />
          <div className={styles.rowCopy}>
            <strong>{item.name}</strong>
            <div className={styles.rowMeta}>
              <span><Users size={11} /> {t('nebula.members', { count: item.memberCount })}</span>
              <span><Hash size={11} /> {item.joinCode}</span>
            </div>
            {item.description && <small>{item.description}</small>}
          </div>
          <button
            type="button"
            className={styles.rowAction}
            onClick={() => item.joined ? onEnter(item.id) : void onJoin(item.id)}
            title={item.joined ? t('nebula.enterGroup') : t('nebula.join')}
            aria-label={`${item.joined ? t('nebula.enterGroup') : t('nebula.join')} ${item.name}`}
          >
            <ArrowRight size={15} />
          </button>
        </div>
      ))}
    </div>
  )
}

export function NebulaDirectory({
  open,
  directory,
  activeNebulaId,
  loading,
  error,
  onClose,
  onEnter,
  onJoin,
  onJoinByCode,
  onCreate,
  onSearch,
}: NebulaDirectoryProps) {
  const { t } = useI18n()
  const [query, setQuery] = useState('')
  const [joinCode, setJoinCode] = useState('')
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)
  const [localError, setLocalError] = useState('')

  const joined = directory.joined ?? []
  const catalog = directory.catalog ?? directory.searchResults ?? []
  const pagination = directory.pagination ?? { page: 1, pageSize: 6, total: catalog.length, totalPages: 1 }

  if (!open) return null

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true)
    setLocalError('')
    try {
      await action()
    } catch (requestError) {
      setLocalError(requestError instanceof Error ? requestError.message : t('nebula.directoryError'))
    } finally {
      setBusy(false)
    }
  }

  const submitSearch = (event: FormEvent) => {
    event.preventDefault()
    void run(() => onSearch(query, 1))
  }

  const submitCode = (event: FormEvent) => {
    event.preventDefault()
    if (!joinCode.trim()) return
    void run(async () => {
      await onJoinByCode(joinCode)
      setJoinCode('')
    })
  }

  const submitCreate = (event: FormEvent) => {
    event.preventDefault()
    if (!name.trim()) return
    void run(async () => {
      await onCreate({ name: name.trim(), description: description.trim() })
      setName('')
      setDescription('')
      setCreating(false)
    })
  }

  return (
    <aside className={styles.panel} aria-label={t('nebula.directory')}>
      <header className={styles.panelHeader}>
        <div><span>{t('nebula.groups')}</span><strong>{t('nebula.groupLobby')}</strong></div>
        <nav className={styles.headerActions} aria-label={t('nebula.directory')}>
          <button
            type="button"
            className={creating ? styles.headerCreateActive : styles.headerCreate}
            onClick={() => {
              setCreating((current) => !current)
              setLocalError('')
            }}
            aria-expanded={creating}
          >
            <Plus size={14} /> {t('nebula.create')}
          </button>
          <button type="button" onClick={onClose} title={t('nebula.closeDirectory')}><X size={17} /></button>
        </nav>
      </header>

      {creating && (
        <form className={styles.createForm} onSubmit={submitCreate}>
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder={t('nebula.createName')} maxLength={160} autoFocus />
          <textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder={t('nebula.createDescription')} maxLength={600} />
          <div><button type="button" onClick={() => setCreating(false)} disabled={busy}>{t('common.cancel')}</button><button type="submit" disabled={busy || !name.trim()}>{busy ? t('nebula.creating') : t('nebula.create')}</button></div>
        </form>
      )}

      <form className={styles.search} onSubmit={submitSearch}>
        <Search size={15} />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('nebula.searchPlaceholder')} />
        <button type="submit" title={t('nebula.search')}><ArrowRight size={14} /></button>
      </form>

      <section>
        <h2><Compass size={13} /> {t('nebula.joined')}</h2>
        <NebulaRows items={joined} activeNebulaId={activeNebulaId} onEnter={onEnter} onJoin={onJoin} />
      </section>

      <section>
        <h2><span className={styles.pulse} /> {query.trim() ? t('nebula.search') : t('nebula.allGroups')}</h2>
        {catalog.length > 0
          ? <NebulaRows items={catalog} activeNebulaId={activeNebulaId} onEnter={onEnter} onJoin={onJoin} />
          : !loading && <p className={styles.empty}>{t('nebula.noResults')}</p>}
        <div className={styles.pagination} aria-label={t('nebula.pagination')}>
          <button
            type="button"
            disabled={pagination.page <= 1 || busy}
            onClick={() => void run(() => onSearch(query, pagination.page - 1))}
            title={t('nebula.previousPage')}
          ><ChevronLeft size={15} /></button>
          <span>{t('nebula.pageStatus', { page: pagination.page, total: pagination.totalPages })}</span>
          <button
            type="button"
            disabled={pagination.page >= pagination.totalPages || busy}
            onClick={() => void run(() => onSearch(query, pagination.page + 1))}
            title={t('nebula.nextPage')}
          ><ChevronRight size={15} /></button>
        </div>
      </section>

      <form className={styles.codeForm} onSubmit={submitCode}>
        <label htmlFor="nebula-code"><Hash size={13} /> {t('nebula.joinCode')}</label>
        <div><input id="nebula-code" value={joinCode} onChange={(event) => setJoinCode(event.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" pattern="[0-9]*" maxLength={6} placeholder={t('nebula.joinCodePlaceholder')} /><button type="submit">{t('nebula.join')}</button></div>
      </form>

      {(loading || busy) && <LoaderCircle className={styles.spinner} size={18} />}
      {(localError || error) && <p className={styles.error} role="status" aria-live="polite">{localError || error}</p>}
    </aside>
  )
}
