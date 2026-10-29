type Props = {
  message: string;
  onDismiss: () => void;
};

export default function StartHere({ message, onDismiss }: Props) {
  return (
    <section className="start-here" aria-label="Tip">
      <p>{message}</p>
      <button type="button" onClick={onDismiss}>Hide tip</button>
    </section>
  );
}
