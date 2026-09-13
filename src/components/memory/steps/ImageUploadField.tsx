import { useRef, type ChangeEvent } from 'react'
import { useAddMemoryStore } from '../../../store/useAddMemoryStore'
import styles from './ImageUploadField.module.css'

/** Upload + local-preview + remove for a single WeChat chat screenshot.
 * File-type/size validation lives in the store (setImageFile returns an
 * error string or null) so this component stays a thin view. */
export function ImageUploadField() {
  const imageFile = useAddMemoryStore((state) => state.imageFile)
  const imagePreviewUrl = useAddMemoryStore((state) => state.imagePreviewUrl)
  const imageError = useAddMemoryStore((state) => state.imageError)
  const setImageFile = useAddMemoryStore((state) => state.setImageFile)
  const clearImage = useAddMemoryStore((state) => state.clearImage)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null
    setImageFile(file)
    event.target.value = ''
  }

  if (imageFile && imagePreviewUrl) {
    return (
      <div className={styles.previewWrapper}>
        <img src={imagePreviewUrl} alt="Chat screenshot preview" className={styles.previewImage} />
        <div className={styles.previewActions}>
          <span className={styles.fileName}>{imageFile.name}</span>
          <div className={styles.previewButtons}>
            <button type="button" className={styles.secondaryButton} onClick={() => inputRef.current?.click()}>
              Upload again
            </button>
            <button type="button" className={styles.removeButton} onClick={() => clearImage()}>
              Delete
            </button>
          </div>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg"
          className={styles.hiddenInput}
          onChange={handleFileChange}
        />
      </div>
    )
  }

  return (
    <div className={styles.dropzoneWrapper}>
      <button type="button" className={styles.dropzone} onClick={() => inputRef.current?.click()}>
        <span className={styles.dropzoneIcon}>+</span>
        <span className={styles.dropzoneLabel}>Upload a WeChat screenshot</span>
        <span className={styles.dropzoneHint}>PNG / JPG, up to 8 MB</span>
      </button>
      {imageError && <p className={styles.errorText}>{imageError}</p>}
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg"
        className={styles.hiddenInput}
        onChange={handleFileChange}
      />
    </div>
  )
}
