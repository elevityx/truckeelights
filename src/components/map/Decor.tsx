// Decorative, aria-hidden map overlays ported from mockup v2. All markup is constant JSX; no data is rendered here.
export function Troll() {
  return (
    <svg className="troll" viewBox="0 0 100 80" aria-hidden="true" focusable="false"><path d="M18 30l-6-22 14 14-2-20 12 17 4-18 7 17 8-16 3 18 11-14-2 19 14-11-8 20z" fill="#7B3FBF"/><path d="M14 44c-12-6-14 6-6 12 4 3 9 3 12 1zM86 44c12-6 14 6 6 12-4 3-9 3-12 1z" fill="#5f7d3a"/><ellipse cx="50" cy="56" rx="37" ry="30" fill="#6f8f45"/><path d="M30 44q8-6 15 0M55 44q8-6 15 0" stroke="#2c3a18" strokeWidth="3" fill="none" strokeLinecap="round"/><g className="eyes"><circle cx="38" cy="52" r="7" fill="#FFE27A"/><circle cx="62" cy="52" r="7" fill="#FFE27A"/><circle cx="39" cy="53" r="3" fill="#140A1F"/><circle cx="61" cy="53" r="3" fill="#140A1F"/></g><path d="M47 58q3 6 6 0" fill="#56702f"/><path d="M33 68q17 10 34 0" stroke="#2c3a18" strokeWidth="3" fill="#2c1a10" /><path d="M38 69l3 5 3-4 3 5 3-5 3 5 3-5 3 4 3-5" fill="#F3ECDA"/></svg>
  );
}

export function Fog() {
  return (
    <>
      <div className="fog" aria-hidden="true" />
      <div className="fog f2" aria-hidden="true" />
    </>
  );
}
