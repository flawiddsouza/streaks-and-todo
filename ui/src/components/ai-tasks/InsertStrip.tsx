interface Props {
  onClick: () => void
}

const preventDefault = (e: React.MouseEvent) => e.preventDefault()

export default function InsertStrip({ onClick }: Props) {
  return (
    <button
      type="button"
      className="ai-insert-strip"
      onMouseDown={preventDefault}
      onClick={onClick}
    >
      <span className="ai-insert-strip-line" />
    </button>
  )
}
