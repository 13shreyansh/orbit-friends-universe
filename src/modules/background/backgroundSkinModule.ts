export interface BackgroundSkinDefinition {
  id: string
  name: { zh: string; en: string }
  description: { zh: string; en: string }
  media: {
    type: 'none' | 'image' | 'video'
    src?: string
    opacity: number
  }
  fallback: string
  overlay: string
  thumbnail: string
}

export const DEFAULT_BACKGROUND_SKIN_ID = 'deep-space'

const skins: BackgroundSkinDefinition[] = [
  {
    id: DEFAULT_BACKGROUND_SKIN_ID,
    name: { zh: 'Deep Night', en: 'Deep Night' },
    description: { zh: 'Quiet and restrained, with the world in focus', en: 'Quiet and restrained, with the world in focus' },
    media: { type: 'none', opacity: 1 },
    fallback: '#030611',
    overlay: 'radial-gradient(circle at 50% 46%, rgba(38, 45, 91, 0.2), transparent 46%), linear-gradient(180deg, rgba(7, 10, 27, 0.08), rgba(1, 2, 9, 0.34))',
    thumbnail: 'radial-gradient(circle at 64% 28%, rgba(129, 153, 229, 0.3), transparent 4%), radial-gradient(circle at 34% 58%, rgba(255, 255, 255, 0.7), transparent 1.5%), linear-gradient(145deg, #101735, #02040d 74%)',
  },
  {
    id: 'rose-galaxy',
    name: { zh: 'Rose Galaxy', en: 'Rose Galaxy' },
    description: { zh: 'A moving galaxy wrapped in warm nebula light', en: 'A moving galaxy wrapped in warm nebula light' },
    media: { type: 'video', src: '/orbit-friends-universe/media/universe-background.mp4', opacity: 0.88 },
    fallback: '#16132f',
    overlay: 'radial-gradient(circle at 50% 48%, transparent 8%, rgba(4, 5, 19, 0.12) 52%, rgba(2, 3, 13, 0.58) 100%), linear-gradient(180deg, rgba(4, 5, 20, 0.12), rgba(8, 7, 27, 0.22))',
    thumbnail: 'radial-gradient(ellipse at 70% 34%, #f2ad76 0 5%, #a05b91 13%, transparent 32%), linear-gradient(155deg, #25204c, #a05a75 58%, #362650)',
  },
]

function resolve(skinId?: string | null): BackgroundSkinDefinition {
  return skins.find((skin) => skin.id === skinId) ?? skins[0]
}

export const backgroundSkinModule = {
  defaultId: DEFAULT_BACKGROUND_SKIN_ID,
  skins,
  resolve,
}
