import Link from 'next/link';
import './home-intro.css';

/**
 * Plain-text intro shown while the map loads (and on the error screen). It is part of the prerendered HTML for `/`,
 * so search engines and link previews see real content even though the map itself is client-rendered.
 */
export default function HomeIntro() {
  return (
    <section className="home-intro" aria-labelledby="home-intro-h">
      <h2 id="home-intro-h">Halloween houses and Christmas lights in Truckee, CA</h2>
      <p>
        Truckee Lights is a free community map of the best decorated houses in Truckee. In the fall it&rsquo;s Truckee Frights,
        for Halloween houses and trick-or-treat routes. After Halloween it&rsquo;s Christmas lights, for a holiday light tour
        around town.
      </p>
      <h3>How it works</h3>
      <ul>
        <li>Find houses on the map or in the list, then get directions.</li>
        <li>Add a decorated house in seconds. No account needed.</li>
        <li>Add photos. They appear after a quick review.</li>
      </ul>
      <p>
        <Link href="/about/">About the map and FAQ</Link>
      </p>
    </section>
  );
}
