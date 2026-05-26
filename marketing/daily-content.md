
---

## 2026-05-26 — Format 1: Reddit Post (r/SideProject)

**Title:** I built an AI decision engine because ChatGPT kept telling me what I wanted to hear

**Body:**

Quick backstory: I was using ChatGPT to help me decide whether to leave my job and go full-time on a side project. Every time I asked, it gave me thoughtful, balanced advice that somehow always nudged me toward whatever I'd just argued for. Classic sycophancy problem.

So I built Hunch — a decision engine where 5 AI advisors debate your decision instead of one model trying to please you:

- **The Skeptic** — pokes holes in your reasoning
- **The Optimist** — finds the upside you're missing
- **The Analyst** — wants data, frameworks, second-order effects
- **The Pragmatist** — cuts through to what's actually doable
- **The Visionary** — asks what this looks like in 5 years

They actually disagree with each other. Sometimes the Skeptic destroys the Optimist's argument. Sometimes the Pragmatist says "this is all noise, here's the one thing that matters." You watch the debate, then make the call.

What I've learned shipping it:
1. People don't want answers — they want clarity on the tradeoffs
2. Multi-agent disagreement surfaces blind spots single-model chat never will
3. The hardest decisions usually have 2-3 hidden assumptions the user hasn't questioned

It's $20/month on Gumroad. Mainly used by founders, PMs, and people facing career pivots. Happy to answer anything about the architecture, the prompt engineering for personas, or the product side.

Link in profile if anyone wants to try it. Would love feedback from this sub specifically — y'all have torched enough of my projects to make this one decent.

---

## 2026-05-26 — Format 3: SEO Article Snippet — "Why Single-Prompt AI Fails at Hard Decisions"

### The Hidden Flaw in Using ChatGPT for Big Decisions

Most people ask AI for advice the same way they'd Google a recipe: one prompt, one answer, done. But here's the problem — when you ask a single AI model "Should I quit my job to start a company?", you get one perspective shaped by whatever framing you used in your question. Lead with excitement, get encouragement. Lead with fear, get caution. The AI mirrors you.

This is called **prompt bias**, and it's why so many AI-assisted decisions feel hollow a week later. You didn't get analysis — you got a reflection.

The fix is **multi-agent deliberation**: forcing several AI perspectives to argue *against each other* before you decide. A skeptic stress-tests assumptions. An analyst demands data. An optimist surfaces upside you're discounting. A pragmatist asks what you can ship by Friday. A visionary zooms out to the 10-year view.

When these viewpoints clash in front of you, the *real* tradeoffs surface — the ones a single chat would have smoothed over.

That's the entire premise behind Hunch: 5 AI advisors debate your decision so you stop outsourcing your judgment to one voice. $49 lifetime at https://hunch.alwaysdata.net
