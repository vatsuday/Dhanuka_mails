import Link from 'next/link';

export default function HomePage() {
  return (
    <main>
      <div className="card">
        <h1>Dhanuka Mails</h1>
        <p className="muted">Email marketing for growing Indian businesses.</p>
        <p>
          <Link href="/signup">Create an account</Link> · <Link href="/login">Log in</Link>
        </p>
      </div>
    </main>
  );
}
