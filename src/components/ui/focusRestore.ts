interface FocusDoc {
  activeElement: unknown;
  body: unknown;
}
interface Focusable {
  isConnected: boolean;
  focus(): void;
}

const canFocus = (x: unknown): x is Focusable =>
  !!x && typeof (x as Focusable).focus === 'function' && typeof (x as Focusable).isConnected === 'boolean';

/** Remember what had focus (the control that opened a sheet); the returned function puts focus back if it is still on the page. */
export function captureFocus(doc: FocusDoc): () => void {
  const opener = doc.activeElement;
  return () => {
    if (opener && opener !== doc.body && canFocus(opener) && opener.isConnected) opener.focus();
  };
}
