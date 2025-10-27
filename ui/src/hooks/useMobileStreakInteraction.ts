import type { TouchEvent } from 'react'
import { useCallback, useRef, useState } from 'react'

export type MobileModalState =
  | {
      isOpen: true
      streakName: string
      date: string
      done: boolean
      note: string
    }
  | { isOpen: false }

interface UseMobileStreakInteractionArgs {
  getRecord: (
    streakName: string,
    date: string,
  ) => { done: boolean; note?: string } | undefined
  toggleStreakRecord: (
    streakName: string,
    date: string,
    options?: { skipAddConfirm?: boolean },
  ) => Promise<boolean | undefined>
  updateNoteContent: (
    streakName: string,
    date: string,
    note: string,
  ) => Promise<void>
}

const TOUCH_MOVE_CANCEL_PX = 12

export function useMobileStreakInteraction({
  getRecord,
  toggleStreakRecord,
  updateNoteContent,
}: UseMobileStreakInteractionArgs) {
  const touchStartPointRef = useRef<{ x: number; y: number } | null>(null)
  const touchScrollingRef = useRef(false)
  const touchTargetRef = useRef<{ streakName: string; date: string } | null>(
    null,
  )
  const suppressNextClickRef = useRef(false)

  const [modalState, setModalState] = useState<MobileModalState>({
    isOpen: false,
  })
  const [noteDraft, setNoteDraft] = useState('')
  const [modalError, setModalError] = useState<string | null>(null)
  const [modalSaving, setModalSaving] = useState(false)

  const consumeClickSuppression = useCallback(() => {
    if (suppressNextClickRef.current) {
      suppressNextClickRef.current = false
      return true
    }
    return false
  }, [])

  const scheduleClickRelease = useCallback(() => {
    suppressNextClickRef.current = true
    setTimeout(() => {
      suppressNextClickRef.current = false
    }, 0)
  }, [])

  const closeModal = useCallback(() => {
    setModalState({ isOpen: false })
    setNoteDraft('')
    setModalError(null)
    suppressNextClickRef.current = false
  }, [])

  const openModal = useCallback(
    (streakName: string, date: string) => {
      const record = getRecord(streakName, date)
      const existingNote = record?.note ?? ''
      setModalState({
        isOpen: true,
        streakName,
        date,
        done: record?.done ?? false,
        note: existingNote,
      })
      setNoteDraft(existingNote)
      setModalError(null)
      suppressNextClickRef.current = true
    },
    [getRecord],
  )

  const handleTouchStart = useCallback(
    (
      event: TouchEvent<HTMLTableCellElement>,
      streakName: string,
      date: string,
    ) => {
      if (event.touches.length === 1) {
        const touch = event.touches[0]
        touchStartPointRef.current = {
          x: touch.clientX,
          y: touch.clientY,
        }
        touchTargetRef.current = { streakName, date }
      } else {
        touchStartPointRef.current = null
        touchTargetRef.current = null
        scheduleClickRelease()
      }
      touchScrollingRef.current = false
    },
    [scheduleClickRelease],
  )

  const handleTouchMove = useCallback(
    (event: TouchEvent<HTMLTableCellElement>) => {
      if (!touchStartPointRef.current) return
      const touch = event.touches[0]
      if (!touch) return
      const dx = Math.abs(touch.clientX - touchStartPointRef.current.x)
      const dy = Math.abs(touch.clientY - touchStartPointRef.current.y)

      if (dx > TOUCH_MOVE_CANCEL_PX || dy > TOUCH_MOVE_CANCEL_PX) {
        touchScrollingRef.current = true
      }
    },
    [],
  )

  const finalizeTouchInteraction = useCallback(() => {
    const wasScrolling = touchScrollingRef.current
    touchStartPointRef.current = null
    touchScrollingRef.current = false
    const target = touchTargetRef.current
    touchTargetRef.current = null
    return { wasScrolling, target }
  }, [])

  const handleTouchEnd = useCallback(
    (
      event: TouchEvent<HTMLTableCellElement>,
      streakName: string,
      date: string,
    ) => {
      const { wasScrolling, target } = finalizeTouchInteraction()

      if (!target || target.streakName !== streakName || target.date !== date) {
        scheduleClickRelease()
        return
      }

      if (wasScrolling) {
        scheduleClickRelease()
        return
      }

      // Prevent the generated synthetic click from firing on newly rendered elements
      event.preventDefault()
      openModal(streakName, date)
    },
    [finalizeTouchInteraction, openModal, scheduleClickRelease],
  )

  const handleTouchCancel = useCallback(() => {
    finalizeTouchInteraction()
    scheduleClickRelease()
  }, [finalizeTouchInteraction, scheduleClickRelease])

  const handleConfirm = useCallback(async () => {
    if (!modalState.isOpen || modalSaving) return

    setModalError(null)
    setModalSaving(true)

    try {
      const { streakName, date, done, note } = modalState

      if (!done) {
        const newStatus = await toggleStreakRecord(streakName, date, {
          skipAddConfirm: true,
        })
        if (newStatus !== true) {
          setModalError(
            'Unable to mark this streak as done. Check any linked tasks.',
          )
          return
        }
      }

      if (noteDraft !== note) {
        await updateNoteContent(streakName, date, noteDraft)
      }

      closeModal()
    } catch (err) {
      setModalError((err as Error).message || 'Unable to save streak update.')
    } finally {
      setModalSaving(false)
    }
  }, [
    closeModal,
    modalSaving,
    modalState,
    noteDraft,
    toggleStreakRecord,
    updateNoteContent,
  ])

  const handleRemove = useCallback(async () => {
    if (!modalState.isOpen || modalSaving) return

    if (!modalState.done) {
      closeModal()
      return
    }

    setModalError(null)
    setModalSaving(true)

    try {
      const newStatus = await toggleStreakRecord(
        modalState.streakName,
        modalState.date,
        { skipAddConfirm: true },
      )
      if (newStatus !== false) {
        setModalError('Unable to remove this streak mark.')
        return
      }

      closeModal()
    } catch (err) {
      setModalError(
        (err as Error).message || 'Unable to remove this streak mark.',
      )
    } finally {
      setModalSaving(false)
    }
  }, [closeModal, modalSaving, modalState, toggleStreakRecord])

  return {
    modalState,
    noteDraft,
    setNoteDraft,
    modalError,
    modalSaving,
    handleConfirm,
    handleRemove,
    closeModal,
    handleTouchStart,
    handleTouchMove,
    handleTouchEnd,
    handleTouchCancel,
    consumeClickSuppression,
  }
}
