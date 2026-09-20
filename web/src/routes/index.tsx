import { createFileRoute, Link } from '@tanstack/react-router'
import { useState } from 'react'

import { EditorMock } from '../components/EditorMock'
import { copyText } from '../lib/clipboard'

export const Route = createFileRoute('/')({
  component: Home,
  head: () => ({
    links: [{ rel: 'canonical', href: 'https://druk.sh/' }],
  }),
})

const GITHUB = 'https://github.com/letstri/druk'

function Cmd({ text, note }: { text: string; note?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      className="cmd"
      onClick={async () => {
        await copyText(text)
        setCopied(true)
        setTimeout(() => setCopied(false), 1400)
      }}
      aria-label={`Copy: ${text}`}
    >
      <span className="line">
        <span className="ps1">$ </span>
        {text}
      </span>
      {copied ? (
        <span className="copied"> # copied</span>
      ) : note ? (
        <span className="comment"> # {note}</span>
      ) : null}
    </button>
  )
}

function Feat({ name, children }: { name: string; children: React.ReactNode }) {
  return (
    <div className="feat">
      <span className="feat-name">{name}</span> — {children}
    </div>
  )
}

function Home() {
  return (
    <main className="term">
      <div className="session">
        <h1 className="comment">
          # <span className="title">druk</span> — a code editor that lives in your terminal.
        </h1>
        <p className="comment"># one self-contained binary. no Node, no Electron, no window.</p>
        <p className="prompt" style={{ marginTop: '1.5rem' }}>
          <span className="ps1">~</span>/<span className="cwd">code</span>{' '}
          <span className="ps1">$</span> druk .
        </p>
      </div>

      <EditorMock />

      <section className="section">
        <p className="prompt">
          <span className="ps1">$</span> <span className="comment"># what's inside</span>
        </p>
        <div className="out">
          <Feat name="tree-sitter syntax">
            eight languages built in, thirty more one install away
          </Feat>
          <Feat name="language servers">
            your own — diagnostics, completion, go to definition, auto-import
          </Feat>
          <Feat name="git">
            stage, commit, sync, stash; diffs inline or side-by-side; merge conflicts resolved right
            in the buffer
          </Feat>
          <Feat name="review notes">
            left on lines, shared with an agent through review.json, replies read as threads
          </Feat>
          <Feat name="search">
            project-wide find and replace; a fuzzy picker that reads file.ts:42 straight from a
            stack trace
          </Feat>
          <Feat name="views">
            markdown rendered in place — mermaid diagrams included — and images
          </Feat>
          <Feat name="folding">from indentation, so it works even where no grammar does</Feat>
          <Feat name="vim mode">
            plus custom keybindings and themes that follow the OS appearance
          </Feat>
          <Feat name="extensions">JSON manifests, not code — installing one runs nothing</Feat>
        </div>
      </section>

      <section className="section">
        <p className="prompt">
          <span className="ps1">$</span> druk --extensions{' '}
          <span className="comment"># languages, servers, themes, icon sets</span>
        </p>
        <div className="out">
          <p className="prompt">
            <Link to="/extensions">browse the extension market →</Link>
          </p>
        </div>
      </section>

      <section className="section">
        <p className="prompt">
          <span className="ps1">$</span>{' '}
          <span className="comment"># install — click a line to copy it</span>
        </p>
        <div className="out">
          <Cmd text="curl -fsSL https://druk.sh/install | bash" />
          <Cmd text="brew install letstri/tap/druk" />
          <Cmd text="npm install -g druk" />
          <Cmd text="bunx druk" note="try it without installing anything" />
          <Cmd text="druk update" note="upgrades this copy, however it was installed" />
        </div>
      </section>

      <section className="section">
        <p className="prompt">
          <span className="ps1">$</span> open <a href={GITHUB}>github.com/letstri/druk</a>{' '}
          <span className="comment"># source, issues, extension market</span>
          <span className="caret" style={{ marginLeft: '0.5rem' }} />
        </p>
      </section>
    </main>
  )
}
