import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { ArrowRight, LoaderCircle, Orbit, SkipForward } from 'lucide-react'
import { authAdapter, type AuthResult } from '../../product/api/authAdapter'
import { useI18n } from '../../product/i18n'
import { useProductStore } from '../../product/store/useProductStore'
import { AuthGalaxy, type AuthVisualPhase } from './AuthGalaxy'
import styles from './AuthScreen.module.css'

type AuthMode = 'signup' | 'signin'

export function AuthScreen() {
  const { t } = useI18n()
  const authenticate = useProductStore((state) => state.authenticate)
  const [mode, setMode] = useState<AuthMode>('signin')
  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [verificationCode, setVerificationCode] = useState('')
  const [sendingCode, setSendingCode] = useState(false)
  const [resendSeconds, setResendSeconds] = useState(0)
  const [verificationRequired, setVerificationRequired] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loadingSeconds, setLoadingSeconds] = useState(0)
  const [visualPhase, setVisualPhase] = useState<AuthVisualPhase>('idle')
  const [pendingAuth, setPendingAuth] = useState<AuthResult | null>(null)
  const [genesisStage, setGenesisStage] = useState(0)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    authAdapter.getConfig()
      .then((config) => {
        if (active) setVerificationRequired(config.emailVerificationRequired)
      })
      .catch(() => {
        // Secure default: keep verification visible when configuration cannot
        // be loaded; the backend remains the final enforcement boundary.
      })
    return () => { active = false }
  }, [])

  const finishFormation = useCallback(() => {
    if (!pendingAuth) return
    authenticate(
      pendingAuth.session,
      pendingAuth.profile,
      pendingAuth.cosmos,
      { arrivalComplete: true },
    )
  }, [authenticate, pendingAuth])

  useEffect(() => {
    if (visualPhase !== 'formation') return
    setGenesisStage(0)
    const timers = [
      window.setTimeout(() => setGenesisStage(1), 1500),
      window.setTimeout(() => setGenesisStage(2), 3000),
      window.setTimeout(() => setGenesisStage(3), 4850),
    ]
    return () => timers.forEach(window.clearTimeout)
  }, [visualPhase])

  useEffect(() => {
    if (!loading) {
      setLoadingSeconds(0)
      return
    }
    const startedAt = Date.now()
    const timer = window.setInterval(() => {
      setLoadingSeconds(Math.floor((Date.now() - startedAt) / 1000))
    }, 500)
    return () => window.clearInterval(timer)
  }, [loading])

  useEffect(() => {
    if (resendSeconds <= 0) return
    const timer = window.setInterval(() => setResendSeconds((value) => Math.max(0, value - 1)), 1000)
    return () => window.clearInterval(timer)
  }, [resendSeconds])

  async function requestVerificationCode() {
    setError('')
    if (!email.includes('@')) {
      setError(t('auth.invalidEmail'))
      return
    }
    setSendingCode(true)
    try {
      const result = await authAdapter.requestSignupVerification(email)
      setResendSeconds(result.resendAfter)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('auth.codeSendFailed'))
    } finally {
      setSendingCode(false)
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    if (!email.includes('@') || password.length < 6) {
      setError(t('auth.invalidCredentials'))
      return
    }
    if (mode === 'signup' && !displayName.trim()) {
      setError(t('auth.nameRequired'))
      return
    }
    if (mode === 'signup' && verificationRequired && !/^\d{6}$/.test(verificationCode)) {
      setError(t('auth.codeRequired'))
      return
    }

    setLoading(true)
    try {
      const credentials = mode === 'signup'
        ? { email, password, displayName, verificationCode: verificationRequired ? verificationCode : undefined }
        : { email, password }
      const result =
        mode === 'signup'
          ? await authAdapter.signUp(credentials)
          : await authAdapter.signIn(credentials)

      // New users—and returning users who have not finished onboarding—should
      // enter the profile flow immediately. The collapse and big-bang ritual
      // belongs to the final creation confirmation, not account creation.
      if (mode === 'signup' || !result.cosmos.selfPlanet) {
        authenticate(result.session, result.profile, result.cosmos)
        return
      }

      setPendingAuth(result)
      setVisualPhase('collapse')
      await new Promise((resolve) => window.setTimeout(resolve, 1850))
      setVisualPhase('formation')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('auth.signalFailed'))
    } finally {
      setLoading(false)
    }
  }

  const formingPlanet = pendingAuth?.cosmos.selfPlanet
  const departing = visualPhase !== 'idle'
  const loadingProgress = Math.min(94, Math.round(8 + 86 * (1 - Math.exp(-loadingSeconds / 25))))
  const loadingMessage = mode === 'signup'
    ? t('auth.progressCreating')
    : loadingSeconds < 8
      ? t('auth.progressVerifying')
      : loadingSeconds < 25
        ? t('auth.progressLoading')
        : loadingSeconds < 50
          ? t('auth.progressCalculating')
          : t('auth.progressRemoteSlow')
  const genesisLabels = formingPlanet ? [
    t('genesis.releaseLight'),
    t('genesis.originWave'),
    t('genesis.gravityCenter'),
    t('genesis.returnCosmos', { name: formingPlanet.identity.name }),
  ] : []

  return (
    <main className={styles.screen}>
      <AuthGalaxy
        phase={visualPhase}
        formationConfig={formingPlanet?.visual}
        onFormationComplete={finishFormation}
      />
      <header className={`${styles.identity} ${departing ? styles.departing : ''}`}>
        <div className={styles.mark}>
          <Orbit size={20} strokeWidth={1.6} />
        </div>
        <div>
          <div className={styles.productName}>SOCIAL COSMOS</div>
          <p className={styles.productLine}>{t('brand.tagline')}</p>
        </div>
      </header>

      <section className={`${styles.formSection} ${departing ? styles.departing : ''}`}>
        <div className={styles.modeSwitch} aria-label={t('auth.mode')}>
          <button
            type="button"
            className={mode === 'signup' ? styles.modeActive : styles.modeButton}
            onClick={() => setMode('signup')}
            disabled={loading}
          >
            {t('auth.createAccount')}
          </button>
          <button
            type="button"
            className={mode === 'signin' ? styles.modeActive : styles.modeButton}
            onClick={() => setMode('signin')}
            disabled={loading}
          >
            {t('auth.signIn')}
          </button>
        </div>

        <div className={styles.headingBlock}>
          <span className={styles.step}>{t('auth.originSignal')}</span>
          <h1>{mode === 'signup' ? t('auth.createTitle') : t('auth.returnTitle')}</h1>
          <p>
            {mode === 'signup'
              ? t('auth.createDescription')
              : t('auth.returnDescription')}
          </p>
        </div>

        <form className={styles.form} onSubmit={handleSubmit}>
          {mode === 'signup' && (
            <label>
              {t('auth.displayName')}
              <input
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                placeholder={t('auth.displayNamePlaceholder')}
                autoComplete="name"
                disabled={loading}
              />
            </label>
          )}
          <label>
            {t('auth.email')}
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder={t('auth.emailPlaceholder')}
              autoComplete="email"
              disabled={loading}
            />
          </label>
          <label>
            {t('auth.password')}
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder={t('auth.passwordPlaceholder')}
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              disabled={loading}
            />
          </label>
          {mode === 'signup' && verificationRequired && (
            <label>
              {t('auth.verificationCode')}
              <span className={styles.verificationRow}>
                <input
                  inputMode="numeric"
                  value={verificationCode}
                  onChange={(event) => setVerificationCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder={t('auth.verificationCodePlaceholder')}
                  autoComplete="one-time-code"
                  disabled={loading}
                />
                <button
                  type="button"
                  className={styles.sendCode}
                  onClick={requestVerificationCode}
                  disabled={loading || sendingCode || resendSeconds > 0}
                >
                  {sendingCode
                    ? t('auth.sendingCode')
                    : resendSeconds > 0
                      ? t('auth.resendCode', { seconds: resendSeconds })
                      : t('auth.sendCode')}
                </button>
              </span>
            </label>
          )}

          {error && <p className={styles.error}>{error}</p>}

          <button type="submit" className={styles.submit} disabled={loading}>
            {loading ? <LoaderCircle className={styles.spinner} size={17} /> : <ArrowRight size={17} />}
            {loading
              ? t('auth.connecting')
              : mode === 'signup' ? t('auth.beginCreation') : t('auth.enterCosmos')}
          </button>
          {loading && (
            <div className={styles.loginProgress} aria-live="polite">
              <div className={styles.progressCopy}>
                <span>{loadingMessage}</span>
                <span>{t('auth.progressElapsed', { seconds: loadingSeconds })}</span>
              </div>
              <div
                className={styles.progressTrack}
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={loadingProgress}
                aria-valuetext={loadingMessage}
              >
                <span className={styles.progressFill} style={{ width: `${loadingProgress}%` }} />
              </div>
              <p className={styles.progressHint}>{t('auth.progressHint')}</p>
            </div>
          )}
        </form>
      </section>

      {visualPhase === 'formation' && formingPlanet && (
        <>
          <div className={styles.genesisStatus}>
            <span>{t('auth.genesis')} / {String(genesisStage + 1).padStart(2, '0')}</span>
            <p>{genesisLabels[genesisStage]}</p>
          </div>
          <button type="button" className={styles.skipFormation} onClick={finishFormation}>
            <SkipForward size={15} />
            {t('auth.skipFormation')}
          </button>
        </>
      )}
    </main>
  )
}
