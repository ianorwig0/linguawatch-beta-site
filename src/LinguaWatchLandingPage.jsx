import React, { useEffect, useMemo, useState } from "react";
import "./LinguaWatchLandingPage.css";

const EXTENSION_DOWNLOAD_URL = `${process.env.PUBLIC_URL || ""}/downloads/LinguaWatch-firefox.zip`;
const EXTENSION_FILENAME = "LinguaWatch-firefox.zip";

const FRIENDS_TEST_DOWNLOAD_URL = `${process.env.PUBLIC_URL || ""}/downloads/LinguaWatch-firefox-test-friends.zip`;
const FRIENDS_TEST_FILENAME = "LinguaWatch-firefox-test-friends.zip";

const FIREFOX_SETUP_URL = `${process.env.PUBLIC_URL || ""}/firefox-setup.html`;
const AUTH_STORAGE_KEY = "linguawatch-auth-session";

const NAV_LINKS = [
  { label: "Product", href: "#product" },
  { label: "How It Works", href: "#how-it-works" },
  { label: "Features", href: "#features" },
  { label: "Why It Works", href: "#why-it-works" },
  { label: "Expectations", href: "#expectations" },
  { label: "Install", href: "#install" },
  { label: "FAQ", href: "#faq" },
];

const AT_A_GLANCE = [
  "Firefox extension — runs on YouTube while you watch",
  "Press Shift+L anytime to freeze & learn the last caption line",
  "Reads on-screen captions and picks teachable phrases from the dialogue",
  "Pauses for a structured lesson: phrase, translation, key words, grammar, quiz",
  "Saved lessons + this video’s recent lines — review without waiting on the API",
  "You add your own OpenAI API key — lessons use the API (usage billed by OpenAI)",
];

const HOW_IT_WORKS_STEPS = [
  {
    title: "Turn on captions on YouTube",
    body: "Pick any video with subtitles. LinguaWatch follows the caption stream in real time — no separate audio upload.",
    icon: "01",
  },
  {
    title: "Watch — or freeze when you hear gold",
    body: "Lessons appear on a schedule you control, or hit Shift+L to learn the last line the moment it lands.",
    icon: "02",
  },
  {
    title: "Pause → micro-lesson → resume",
    body: "The player pauses; you get the line, translation, mapped keywords, grammar, and a quick quiz. One click continues playback.",
    icon: "03",
  },
  {
    title: "Review what you saved",
    body: "Completed lessons stay on your device. Re-open them from the popup or export CSV — no second app required.",
    icon: "04",
  },
];

const FEATURES = [
  {
    title: "Freeze & learn (Shift+L)",
    body: "Heard something worth keeping? One shortcut starts a lesson from the latest caption line — no waiting for the next scheduled pause.",
    icon: "flow",
  },
  {
    title: "Phrase-first lessons",
    body: "Lessons anchor on full lines and expressions from the subtitles, not isolated dictionary lookups.",
    icon: "spark",
  },
  {
    title: "Same scene, same meaning",
    body: "Translation and notes reference the exact dialogue you heard, with recent caption context so the lesson stays grounded.",
    icon: "translate",
  },
  {
    title: "Saved lessons on device",
    body: "Every completed lesson is stored locally. Review instantly from the popup or re-run a fresh lesson when you want practice.",
    icon: "chips",
  },
  {
    title: "Grammar without the textbook tone",
    body: "Short notes explain the pattern the line illustrates — enough to understand, not a lecture.",
    icon: "grammar",
  },
  {
    title: "Pacing you control",
    body: "Adjust how often lessons surface, plus manual Shift+L when the video hands you something perfect.",
    icon: "pace",
  },
];

const FAQ_ITEMS = [
  {
    q: "What is LinguaWatch, in one sentence?",
    a: "A Firefox browser extension for YouTube that turns caption lines into occasional pause-and-learn moments: translation, keywords, and a brief grammar note, then you keep watching.",
  },
  {
    q: "What is Shift+L / Freeze & learn?",
    a: "While watching YouTube with captions on, press Shift+L to start a lesson from the most recent caption line — instantly, without waiting for the next scheduled lesson.",
  },
  {
    q: "Are lessons saved?",
    a: "Yes. Every completed lesson is stored on your device in the extension popup. Tap to review instantly, or use ↻ to run a fresh lesson. You can also export CSV.",
  },
  {
    q: "Why add sign in?",
    a: "Sign in links usage to a learner account so progress, preferences, and future streak/history features can follow you across sessions.",
  },
  {
    q: "Why do I need an OpenAI API key?",
    a: "Lessons and optional audio are generated through OpenAI’s API. You paste your key in the LinguaWatch toolbar popup so requests run under your OpenAI account and normal API pricing applies. There is no separate LinguaWatch cloud in this beta.",
  },
  {
    q: "Why Firefox only? What about Chrome?",
    a: "This beta targets Firefox first. Chrome and Edge builds are on the roadmap so installs can eventually be one-click from browser stores.",
  },
  {
    q: "My extension vanished after closing Firefox — is that a bug?",
    a: "Temporary add-ons (the current ZIP install) are removed when Firefox fully quits. Reload the add-on from about:debugging, or wait for a signed build on Mozilla Add-ons for a persistent install.",
  },
  {
    q: "Will bad auto-captions ruin lessons?",
    a: "Lessons follow whatever text YouTube’s captions show. Auto-generated captions can be noisy; videos with clean, human-edited subs usually produce better phrases and teaching content.",
  },
  {
    q: "How is this different from dual subtitles or hover-translate tools?",
    a: "Those tools optimize for reading along or looking up words. LinguaWatch proactively selects phrases and stops the video for a structured mini-lesson when it matters — closer to a tutor interrupting at useful points than a passive subtitle overlay.",
  },
  {
    q: "Where does it work?",
    a: "YouTube in Firefox, with captions turned on. Other browsers and streaming sites are not supported yet.",
  },
  {
    q: "What videos can I use?",
    a: "Any YouTube video that has usable captions in the language you’re learning from. The extension uses that caption text as the source for phrases and lessons.",
  },
  {
    q: "Will it nag me every few seconds?",
    a: "No. You control lesson frequency, and lessons are spaced so you can stay with the story or tutorial you’re watching.",
  },
  {
    q: "Which languages?",
    a: "Spanish is the first learning focus. More target languages may follow as the product grows.",
  },
  {
    q: "Beginners or advanced?",
    a: "Both benefit: beginners get structure tied to real speech; advanced learners mine nuance from phrases they already hear in context.",
  },
  {
    q: "Does it run in real time?",
    a: "Yes. It follows the active caption track as you watch and builds lessons from what was just on screen.",
  },
];

function getSavedSession() {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.email) return null;
    return parsed;
  } catch {
    return null;
  }
}

function AuthModal({ isOpen, onClose, onSubmit, errorMessage }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  useEffect(() => {
    if (!isOpen) {
      setEmail("");
      setPassword("");
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSubmit = (event) => {
    event.preventDefault();
    onSubmit({ email, password });
  };

  return (
    <div className="lw-auth-modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="lw-auth-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="lw-auth-title"
        onClick={(event) => event.stopPropagation()}
      >
        <button type="button" className="lw-auth-close" onClick={onClose} aria-label="Close sign in modal">
          ×
        </button>
        <p className="lw-eyebrow">Account</p>
        <h2 id="lw-auth-title">Sign in to LinguaWatch</h2>
        <p className="lw-auth-copy">Use sign in to save your setup and keep your learning flow tied to one account.</p>
        <form className="lw-auth-form" onSubmit={handleSubmit}>
          <label htmlFor="lw-email">Email</label>
          <input
            id="lw-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
            required
          />
          <label htmlFor="lw-password">Password</label>
          <input
            id="lw-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="At least 8 characters"
            minLength={8}
            required
          />
          {errorMessage ? <p className="lw-auth-error">{errorMessage}</p> : null}
          <button type="submit" className="lw-btn lw-btn-primary lw-auth-submit">
            Sign In
          </button>
        </form>
      </div>
    </div>
  );
}

function Icon({ kind }) {
  const paths = {
    spark: "M12 3l2.8 5.7L21 10l-4.5 4.4L17.6 21 12 18l-5.6 3 1.1-6.6L3 10l6.2-1.3L12 3z",
    translate:
      "M4 6h10M9 6s-.4 5.5-5 9m5-9c1.3 2.9 3.6 5.7 7 8m4-8h-6m3 0v11m0 0-3-3m3 3 3-3",
    chips: "M4 8h16M6 4h12a2 2 0 012 2v12a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2zm2 8h3m4 0h3",
    grammar:
      "M6 5h12a1 1 0 011 1v12a1 1 0 01-1 1H6a1 1 0 01-1-1V6a1 1 0 011-1zm3 4h6m-6 4h4",
    flow: "M4 12h12m0 0-4-4m4 4-4 4m5-10h3v12h-3",
    pace: "M12 5v7l4 2m4-2a8 8 0 11-16 0 8 8 0 0116 0z",
  };

  const d = paths[kind] || paths.spark;
  return (
    <svg viewBox="0 0 24 24" className="lw-icon-svg" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d={d} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SectionHeader({ eyebrow, title, description }) {
  return (
    <div className="lw-section-header">
      <p className="lw-eyebrow">{eyebrow}</p>
      <h2>{title}</h2>
      {description ? <p className="lw-section-description">{description}</p> : null}
    </div>
  );
}

function AtAGlancePills() {
  return (
    <div className="lw-trust-grid">
      {AT_A_GLANCE.map((item) => (
        <div key={item} className="lw-trust-pill">
          <span className="lw-dot" />
          <span>{item}</span>
        </div>
      ))}
    </div>
  );
}

function HeroVisual() {
  return (
    <div className="lw-hero-visual" aria-hidden="true">
      <div className="lw-video-shell">
        <div className="lw-video-topbar">
          <span />
          <span />
          <span />
        </div>
        <div className="lw-video-body">
          <div className="lw-video-info">
            <div className="lw-video-overlay-label">Shift+L · Freeze &amp; learn</div>
            <div className="lw-example-box">
              <p className="lw-example-box-label">You choose the moment</p>
              <p className="lw-example-box-text">Last caption line → instant lesson → saved for review</p>
            </div>
          </div>
          <div className="lw-caption-line">“I’ve been trying to understand this for weeks.”</div>
        </div>
      </div>

      <div className="lw-floating-lesson-card">
        <div className="lw-floating-progress" />
        <p className="lw-mini-heading">English Phrase</p>
        <p className="lw-mini-copy">I’ve been trying to understand this for weeks.</p>
        <p className="lw-mini-heading">Spanish</p>
        <p className="lw-mini-translation">He estado intentando entender esto durante semanas.</p>
        <div className="lw-chip-row">
          <span>trying → intentando</span>
          <span>understand → entender</span>
          <span>weeks → semanas</span>
        </div>
        <button type="button">Continue Watching</button>
      </div>
    </div>
  );
}

function WhySection() {
  return (
    <section className="lw-section" id="why-it-works">
      <div className="lw-container lw-why-grid">
        <div>
          <SectionHeader
            eyebrow="Why LinguaWatch"
            title="Structured lessons from the video itself — not a second screen."
            description="Many extensions help you read subtitles or look up words. LinguaWatch is built for deliberate lesson moments inside the same watch session."
          />
        </div>
        <div className="lw-why-cards">
          <article>
            <h3>Dual subs and popups = reading support</h3>
            <p>
              Popular tools overlay translations or definitions on demand. That’s great for scanning — but easy to stay passive.
            </p>
          </article>
          <article>
            <h3>LinguaWatch = pause-and-teach moments</h3>
            <p>
              It selects phrases from the caption line you’re living in, then stops briefly to unpack that line as a lesson before you continue.
            </p>
          </article>
          <article>
            <h3>Same habit, harder learning</h3>
            <p>
              You keep your YouTube routine; the extension adds bite-sized comprehension work when the content hands you something worth retaining.
            </p>
          </article>
        </div>
      </div>
    </section>
  );
}

function ProductPreviewSection() {
  return (
    <section className="lw-section" id="product">
      <div className="lw-container">
        <SectionHeader
          eyebrow="Product Preview"
          title="What you see during a lesson"
          description="The panel mirrors a typical session: original line, translation, keyword pairs, a short grammar note, then back to the video."
        />

        <div className="lw-preview-shell">
          <div className="lw-preview-video">
            <div className="lw-preview-video-header">
              <span />
              <span />
              <span />
            </div>
            <div className="lw-preview-video-content">
              <div className="lw-preview-caption">“We should have left earlier if we wanted the best seats.”</div>
            </div>
          </div>

          <div className="lw-preview-panel">
            <div className="lw-preview-progress" />
            <p className="lw-preview-label">English Phrase</p>
            <p className="lw-preview-text-en">We should have left earlier if we wanted the best seats.</p>

            <p className="lw-preview-label">Spanish</p>
            <p className="lw-preview-text-es">Deberíamos haber salido antes si queríamos los mejores asientos.</p>

            <p className="lw-preview-label">Key Words</p>
            <div className="lw-preview-chips">
              <span>should → deberíamos</span>
              <span>left → salido</span>
              <span>earlier → antes</span>
              <span>best seats → mejores asientos</span>
            </div>

            <p className="lw-preview-label">Grammar Note</p>
            <p className="lw-preview-grammar">
              “Should have + past participle” describes an action that was advisable in the past.
            </p>

            <button type="button">Continue Watching</button>
          </div>
        </div>
      </div>
    </section>
  );
}

function ExpectationsSection() {
  const privacyHref = `${process.env.PUBLIC_URL || ""}/privacy.html`;

  return (
    <section className="lw-section lw-expectations" id="expectations">
      <div className="lw-container">
        <SectionHeader
          eyebrow="Before you install"
          title="Requirements, cost, and privacy — upfront"
          description="Fewer surprises: what you need for the beta, what we’re fixing next, and how your data moves."
        />
        <div className="lw-expectations-grid">
          <article className="lw-expectation-card">
            <h3>What you need</h3>
            <ul className="lw-expect-list">
              <li>
                <strong>Firefox</strong> on desktop (today’s install is a developer-style temporary add-on).
              </li>
              <li>
                <strong>YouTube</strong> with <strong>captions on</strong> — lesson content comes from that caption text.
              </li>
              <li>
                <strong>OpenAI API key</strong> in the extension popup. Lessons call OpenAI; usage is billed to your OpenAI account.
              </li>
            </ul>
          </article>
          <article className="lw-expectation-card">
            <h3>What we’re improving</h3>
            <ul className="lw-expect-list">
              <li>
                <strong>Signed Mozilla Add-ons</strong> listing so the extension survives browser restarts without reloading the ZIP.
              </li>
              <li>
                <strong>Chrome / Edge</strong> builds on the roadmap to match how most people browse.
              </li>
              <li>
                <strong>Caption quality</strong> will always depend on YouTube — we surface lessons from what’s on screen, good or bad.
              </li>
            </ul>
          </article>
          <article className="lw-expectation-card lw-expectation-card-span">
            <h3>Privacy in one line</h3>
            <p className="lw-expect-lead">
              Phrases you study are sent to OpenAI to generate lesson text (their policy applies). No separate LinguaWatch backend in this beta — see{" "}
              <a href={privacyHref}>Privacy</a> for detail.
            </p>
          </article>
        </div>
      </div>
    </section>
  );
}

function InstallSection() {
  return (
    <section className="lw-section" id="install">
      <div className="lw-container">
        <SectionHeader
          eyebrow="Install"
          title="Add LinguaWatch to Firefox"
          description="Distributed as a ZIP for manual install today (temporary add-on). Full Mozilla Add-ons listing can follow once the build is signed."
        />
        <p className="lw-install-onepage">
          <a className="lw-btn lw-btn-secondary" href={FIREFOX_SETUP_URL}>
            All Firefox links on one page
          </a>
        </p>
        <div className="lw-install-grid">
          <article className="lw-install-card">
            <h3>1. Download</h3>
            <p>Get the packaged extension (ZIP) from this site.</p>
            <div className="lw-install-download-stack">
              <a
                className="lw-btn lw-btn-primary"
                href={EXTENSION_DOWNLOAD_URL}
                download={EXTENSION_FILENAME}
              >
                Download for Firefox
              </a>
              <a
                className="lw-btn lw-btn-secondary"
                href={FRIENDS_TEST_DOWNLOAD_URL}
                download={FRIENDS_TEST_FILENAME}
              >
                Friends test build
              </a>
            </div>
          </article>
          <article className="lw-install-card">
            <h3>2. Open Firefox debugging</h3>
            <p>
              In Firefox, open <code className="lw-code">about:debugging#/runtime/this-firefox</code> in the address bar.
            </p>
          </article>
          <article className="lw-install-card">
            <h3>3. Load temporary add-on</h3>
            <p>
              Click <strong>Load Temporary Add-on…</strong>, unzip the download if needed, and select{" "}
              <code className="lw-code">manifest.json</code> from the extracted folder.
            </p>
          </article>
          <article className="lw-install-card">
            <h3>4. Key + YouTube</h3>
            <p>
              Open the LinguaWatch toolbar popup and save your <strong>OpenAI API key</strong> (required for lessons). Then visit YouTube with captions on and start from the toolbar icon.
            </p>
            <a className="lw-btn lw-btn-secondary lw-install-yt" href="https://www.youtube.com/" target="_blank" rel="noreferrer">
              Open YouTube
            </a>
          </article>
        </div>
        <p className="lw-install-note">
          Temporary add-ons reset when Firefox closes. For a permanent install, publish to Mozilla Add-ons or install a signed{" "}
          <code className="lw-code">.xpi</code>.
        </p>

        <div className="lw-install-troubleshoot">
          <h3 className="lw-install-troubleshoot-title">If something goes wrong</h3>
          <ul className="lw-install-troubleshoot-list">
            <li>
              <strong>“Missing OpenAI API key” or lessons won’t load</strong> — Click the LinguaWatch icon → paste your OpenAI API key → save, then try again on a captioned video.
            </li>
            <li>
              <strong>Extension disappeared after quitting Firefox</strong> — Expected with temporary add-ons. Re-open{" "}
              <code className="lw-code">about:debugging#/runtime/this-firefox</code> and load <code className="lw-code">manifest.json</code> again.
            </li>
            <li>
              <strong>ZIP download fails or 404</strong> — Confirm you’re on the latest deploy of this site; hard-refresh or try the copy-paste URLs on{" "}
              <a href={FIREFOX_SETUP_URL}>the setup page</a>.
            </li>
            <li>
              <strong>Weird phrases from bad captions</strong> — Try another video or turn on a higher-quality subtitle track if the video offers one.
            </li>
          </ul>
        </div>
      </div>
    </section>
  );
}

function FAQSection() {
  const [openIndex, setOpenIndex] = useState(0);

  return (
    <section className="lw-section" id="faq">
      <div className="lw-container">
        <SectionHeader
          eyebrow="FAQ"
          title="Common questions"
          description="Scope, platforms, and how LinguaWatch differs from subtitle tools."
        />
        <div className="lw-faq-list">
          {FAQ_ITEMS.map((item, idx) => {
            const isOpen = idx === openIndex;
            return (
              <article key={item.q} className={`lw-faq-item ${isOpen ? "is-open" : ""}`}>
                <button
                  type="button"
                  className="lw-faq-trigger"
                  onClick={() => setOpenIndex(isOpen ? -1 : idx)}
                  aria-expanded={isOpen}
                >
                  <span>{item.q}</span>
                  <span className="lw-faq-plus">{isOpen ? "−" : "+"}</span>
                </button>
                <div className="lw-faq-panel" hidden={!isOpen}>
                  <p>{item.a}</p>
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}

export default function LinguaWatchLandingPage() {
  const [scrolled, setScrolled] = useState(false);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authError, setAuthError] = useState("");
  const [session, setSession] = useState(() => getSavedSession());

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const year = useMemo(() => new Date().getFullYear(), []);
  const signedInLabel = session?.email || "Signed in";

  const openSignIn = () => {
    setAuthError("");
    setAuthModalOpen(true);
  };

  const closeSignIn = () => {
    setAuthError("");
    setAuthModalOpen(false);
  };

  const handleSignIn = ({ email, password }) => {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail || !normalizedEmail.includes("@")) {
      setAuthError("Enter a valid email address.");
      return;
    }
    if (password.length < 8) {
      setAuthError("Password must be at least 8 characters.");
      return;
    }

    const nextSession = {
      email: normalizedEmail,
      signedInAt: new Date().toISOString(),
    };

    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(nextSession));
    setSession(nextSession);
    setAuthModalOpen(false);
    setAuthError("");
  };

  const handleSignOut = () => {
    localStorage.removeItem(AUTH_STORAGE_KEY);
    setSession(null);
  };

  return (
    <div className="lw-page" id="top">
      <div className="lw-bg-glow lw-bg-glow-1" aria-hidden="true" />
      <div className="lw-bg-glow lw-bg-glow-2" aria-hidden="true" />

      <header className={`lw-nav-wrap ${scrolled ? "is-scrolled" : ""}`}>
        <div className="lw-container lw-nav">
          <a href="#top" className="lw-brand" aria-label="LinguaWatch Home">
            <span className="lw-brand-mark">LW</span>
            <span>LinguaWatch</span>
          </a>
          <nav className="lw-nav-links" aria-label="Primary navigation">
            {NAV_LINKS.map((link) => (
              <a key={link.label} href={link.href}>
                {link.label}
              </a>
            ))}
          </nav>
          <div className="lw-nav-actions">
            {session ? (
              <>
                <span className="lw-session-pill">{signedInLabel}</span>
                <button type="button" className="lw-btn lw-btn-secondary" onClick={handleSignOut}>
                  Sign Out
                </button>
              </>
            ) : (
              <button type="button" className="lw-btn lw-btn-secondary" onClick={openSignIn}>
                Sign In
              </button>
            )}
            <a className="lw-btn lw-btn-primary" href={EXTENSION_DOWNLOAD_URL} download={EXTENSION_FILENAME}>
              Install Extension
            </a>
          </div>
        </div>
      </header>

      <main>
        <section className="lw-hero">
          <div className="lw-container lw-hero-grid">
            <div className="lw-hero-copy">
              <p className="lw-eyebrow">Firefox extension · YouTube · Freeze &amp; learn</p>
              <h1>Heard something good? Hit Shift+L — learn that line.</h1>
              <p className="lw-hero-support">
                LinguaWatch is a Firefox tutor for YouTube: it reads captions, pauses for structured mini-lessons
                (translation, keywords, grammar, quiz), saves what you learned, and lets you resume the show. Built
                for Spanish-first immersion.
              </p>
              <div className="lw-hero-ctas">
                {session ? (
                  <button type="button" className="lw-btn lw-btn-secondary">
                    Signed in as {signedInLabel}
                  </button>
                ) : (
                  <button type="button" className="lw-btn lw-btn-secondary" onClick={openSignIn}>
                    Sign In to Save Progress
                  </button>
                )}
                <a href={EXTENSION_DOWNLOAD_URL} download={EXTENSION_FILENAME} className="lw-btn lw-btn-primary">
                  Install Extension
                </a>
                <a href="#how-it-works" className="lw-btn lw-btn-secondary">
                  See How It Works
                </a>
              </div>
              <div className="lw-trust-line">
                <span className="lw-dot" />
                Not dual subtitles — a tutor that pauses the show and remembers your phrases
              </div>
              <p className="lw-hero-note">
                Beta: Firefox desktop · YouTube + captions · bring your OpenAI API key (
                <a href="#expectations">details</a>)
              </p>
            </div>
            <HeroVisual />
          </div>
        </section>

        <section className="lw-section lw-social-proof">
          <div className="lw-container">
            <SectionHeader
              eyebrow="What it is"
              title="A YouTube learning layer for Firefox"
              description="Plain facts — so you know exactly what you’re installing."
            />
            <AtAGlancePills />
          </div>
        </section>

        <section className="lw-section" id="how-it-works">
          <div className="lw-container">
            <SectionHeader
              eyebrow="How It Works"
              title="From captions to lesson in four steps"
              description="Everything happens on the video page — no separate course or flashcard deck required."
            />
            <div className="lw-steps-grid">
              {HOW_IT_WORKS_STEPS.map((step) => (
                <article key={step.title} className="lw-step-card">
                  <div className="lw-step-index">{step.icon}</div>
                  <h3>{step.title}</h3>
                  <p>{step.body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="lw-section" id="features">
          <div className="lw-container">
            <SectionHeader
              eyebrow="Features"
              title="What each lesson includes"
              description="Each interruption is small on purpose: enough structure to learn, not enough to replace the video."
            />
            <div className="lw-feature-grid">
              {FEATURES.map((feature) => (
                <article key={feature.title} className="lw-feature-card">
                  <div className="lw-icon-wrap">
                    <Icon kind={feature.icon} />
                  </div>
                  <h3>{feature.title}</h3>
                  <p>{feature.body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <WhySection />
        <ProductPreviewSection />
        <ExpectationsSection />
        <InstallSection />
        <FAQSection />

        <section className="lw-section" id="final-cta">
          <div className="lw-container">
            <div className="lw-final-cta-card">
              <p className="lw-eyebrow">Start now</p>
              <h2>Learn from the next video you press play on.</h2>
              <p>
                Install the Firefox extension, open a captioned YouTube video, and let LinguaWatch turn standout lines into short lessons without leaving the tab.
              </p>
              <div className="lw-final-cta-row">
                <a href={EXTENSION_DOWNLOAD_URL} download={EXTENSION_FILENAME} className="lw-btn lw-btn-primary">
                  Download extension
                </a>
                <a href="#install" className="lw-btn lw-btn-secondary">
                  Install instructions
                </a>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="lw-footer">
        <div className="lw-container lw-footer-grid">
          <div>
            <a href="#top" className="lw-brand">
              <span className="lw-brand-mark">LW</span>
              <span>LinguaWatch</span>
            </a>
            <p className="lw-footer-copy">
              Firefox extension for YouTube: caption-driven phrase lessons with translation, keywords, and grammar — on your watch, on your pace.
            </p>
          </div>
          <div className="lw-footer-links">
            {NAV_LINKS.map((link) => (
              <a key={link.label} href={link.href}>
                {link.label}
              </a>
            ))}
          </div>
          <div className="lw-footer-meta">
            <a href={`${process.env.PUBLIC_URL || ""}/privacy.html`}>Privacy</a>
            <a href={`${process.env.PUBLIC_URL || ""}/terms.html`}>Terms</a>
            <span>© {year} LinguaWatch</span>
          </div>
        </div>
      </footer>

      <AuthModal isOpen={authModalOpen} onClose={closeSignIn} onSubmit={handleSignIn} errorMessage={authError} />
    </div>
  );
}
