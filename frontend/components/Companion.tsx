import React from 'react';
import './Companion.css';

// Shared CSS character: no image downloads, model calls or animation runtime.
export function Companion({ busy = false }: { busy?: boolean }) {
  return <div className={`question-companion ${busy ? 'is-busy' : ''}`} aria-hidden="true"><i /><i /><span /></div>;
}
