'use client';

import { supabaseConfigured } from '@/config/public-env';

// Placeholder: WP-B replaces this. Renders a graceful state when env is missing.
export default function HomePage() {
  return (
    <main className="p-6">
      <h1 className="text-2xl font-bold">Truckee Lights</h1>
      {!supabaseConfigured() && <p>The map is not configured in this environment.</p>}
    </main>
  );
}
