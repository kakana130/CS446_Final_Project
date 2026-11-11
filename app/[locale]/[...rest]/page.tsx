import { notFound } from 'next/navigation';

// Unknown paths under a valid locale render the localized not-found page inside the layout.
export default function CatchAll() {
  notFound();
}
