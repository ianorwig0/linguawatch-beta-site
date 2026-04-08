import React, { useEffect, useMemo, useState } from "react";
import "./LinguaWatchLandingPage.css";

const EXTENSION_DOWNLOAD_URL = `${process.env.PUBLIC_URL || ""}/downloads/LinguaWatch-firefox.zip`;
const EXTENSION_FILENAME = "LinguaWatch-firefox.zip";

const NAV_LINKS = [
  { label: "Product", href: "#product" },
  { label: "How It Works", href: "#how-it-works" },
  { label: "Features", href: "#features" },
  { label: "Why It Works", href: "#why-it-works" },
  { label: "Install", href: "#install" },
  { label: "FAQ", href: "#faq" },
];

const TRUST_POINTS = [
  "Designed for focused learners",
  "Real-time phrase breakdowns",
  "Micro-lessons without leaving your video",
  "Built for immersive study sessions",
];

const HOW_IT_WORKS_STEPS = [
  {
    title: "Watch with captions on",
    body: "Start any captioned video. LinguaWatch listens quietly in the background for high-value phrases.",
    icon: "01",
  },
  {
    title: "Smart phrase detection",
    body: "It identifies useful, contextual phrases instead of random single words, keeping lessons relevant to what you are watching.",
    icon: "02",
  },
  {
    title: "Guided micro-lesson",
    body: "At the right moment, the video pauses and a structured lesson appears with translation, key vocabulary, and grammar.",
    icon: "03",
  },
  {
    title: "Resume with stronger context",
    body: "Continue watching with better comprehension, reinforced memory, and more confidence in real usage.",
    icon: "04",
  },
];

const FEATURES = [
  {
    title: "Smart phrase selection",
    body: "Learns from subtitles and surfaces phrases with practical language value, not noise.",
    icon: "spark",
  },
  {
    title: "Contextual translations",
    body: "Explanations are tied to the moment in the video, helping meaning stick faster.",
    icon: "translate",
  },
  {
    title: "Vocabulary breakdowns",
    body: "Key words are split into clear pairings so you can absorb useful building blocks.",
    icon: "chips",
  },
  {
    title: "Grammar in plain English",
    body: "Concise grammar notes explain what the phrase demonstrates without overwhelming detail.",
    icon: "grammar",
  },
  {
    title: "Flow-preserving learning",
    body: "Lessons are timed to teach without derailing your session, then you continue instantly.",
    icon: "flow",
  },
  {
    title: "Personalized pacing",
    body: "Tune lesson frequency to match your study style, attention span, and session goals.",
    icon: "pace",
  },
];

const FAQ_ITEMS = [
  {
    q: "What videos does LinguaWatch work with?",
    a: "LinguaWatch is designed for YouTube videos that have captions available. Captions provide the phrase context used for each lesson.",
  },
  {
    q: "Does it interrupt too often?",
    a: "No. You can control lesson frequency, and LinguaWatch spaces lessons intelligently so you stay engaged with your video.",
  },
  {
    q: "What languages will it support?",
    a: "Spanish is the first focus. Additional target languages are planned as the core learning experience expands.",
  },
  {
    q: "Is it for beginners or intermediate learners?",
    a: "Both. Beginners gain structured context and vocabulary, while intermediate learners build faster real-world comprehension.",
  },
  {
    q: "Does it work in real time?",
    a: "Yes. LinguaWatch continuously monitors active captions and generates lessons from what was just spoken.",
  },
];

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

function TrustPills() {
  return (
    <div className="lw-trust-grid">
      {TRUST_POINTS.map((item) => (
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
            <div className="lw-video-overlay-label">Paused for Lesson</div>
            <div className="lw-example-box">
              <p className="lw-example-box-label">Example lesson moment</p>
              <p className="lw-example-box-text">Smart pause + contextual translation + key vocabulary</p>
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
            title="Language learning that stays inside the content."
            description="Most language tools force a context switch. LinguaWatch does the opposite."
          />
        </div>
        <div className="lw-why-cards">
          <article>
            <h3>Most tools pull you away</h3>
            <p>
              Traditional apps separate vocabulary from real media. You memorize in one place and try to apply it in
              another.
            </p>
          </article>
          <article>
            <h3>LinguaWatch teaches in context</h3>
            <p>
              Lessons are drawn from what you just heard, so meaning, grammar, and usage stay connected to real input.
            </p>
          </article>
          <article>
            <h3>Passive viewing becomes active learning</h3>
            <p>
              Every session compounds comprehension naturally, without requiring a separate study routine to make
              progress.
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
          title="A sleek learning layer built for immersion."
          description="A premium, distraction-free interface that pauses at the right moment and gets you back to watching with better understanding."
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

function InstallSection() {
  return (
    <section className="lw-section" id="install">
      <div className="lw-container">
        <SectionHeader
          eyebrow="Install"
          title="Add LinguaWatch to Firefox"
          description="Download the extension package, then load it in Firefox in a few steps."
        />
        <div className="lw-install-grid">
          <article className="lw-install-card">
            <h3>1. Download</h3>
            <p>Get the packaged extension (ZIP) from this site.</p>
            <a
              className="lw-btn lw-btn-primary lw-install-download"
              href={EXTENSION_DOWNLOAD_URL}
              download={EXTENSION_FILENAME}
            >
              Download for Firefox
            </a>
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
            <h3>4. Open YouTube</h3>
            <p>
              Visit YouTube with captions on. Use the LinguaWatch toolbar icon to adjust settings and start a session.
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
          description="Clear answers before you install."
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

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const year = useMemo(() => new Date().getFullYear(), []);

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
          <a className="lw-btn lw-btn-primary" href={EXTENSION_DOWNLOAD_URL} download={EXTENSION_FILENAME}>
            Install Extension
          </a>
        </div>
      </header>

      <main>
        <section className="lw-hero">
          <div className="lw-container lw-hero-grid">
            <div className="lw-hero-copy">
              <p className="lw-eyebrow">AI-powered language immersion</p>
              <h1>Turn videos into structured language lessons.</h1>
              <p className="lw-hero-support">
                LinguaWatch transforms passive watching into active learning with intelligent micro-lessons built from
                the exact phrases you just heard.
              </p>
              <div className="lw-hero-ctas">
                <a href={EXTENSION_DOWNLOAD_URL} download={EXTENSION_FILENAME} className="lw-btn lw-btn-primary">
                  Install Extension
                </a>
                <a href="#how-it-works" className="lw-btn lw-btn-secondary">
                  See How It Works
                </a>
              </div>
              <div className="lw-trust-line">
                <span className="lw-dot" />
                Built for immersive self-learning and YouTube-based language sessions
              </div>
            </div>
            <HeroVisual />
          </div>
        </section>

        <section className="lw-section lw-social-proof">
          <div className="lw-container">
            <SectionHeader
              eyebrow="Trusted Experience"
              title="Purpose-built for focused learners"
              description="Structured, contextual, and designed to keep momentum while you watch."
            />
            <TrustPills />
          </div>
        </section>

        <section className="lw-section" id="how-it-works">
          <div className="lw-container">
            <SectionHeader
              eyebrow="How It Works"
              title="A clear four-step learning loop"
              description="Simple in flow, rigorous in outcomes."
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
              title="Everything needed for contextual progress"
              description="Premium lesson quality with minimal friction."
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
        <InstallSection />
        <FAQSection />

        <section className="lw-section" id="final-cta">
          <div className="lw-container">
            <div className="lw-final-cta-card">
              <p className="lw-eyebrow">Start now</p>
              <h2>Turn your next video into a language lesson.</h2>
              <p>
                Install LinguaWatch and make every caption count with structured micro-learning built directly into your
                watch flow.
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
              LinguaWatch turns real video moments into structured language comprehension.
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
    </div>
  );
}
