# Azure SRE with GitHub Copilot

This repository is a GitHub Skills exercise. The learner works simulated AKS incidents in the **Azure SRE console** canvas, from the project extension in `.github/extensions/sre-console/`.

When the learner asks you to act as Azure SRE Agent:

- Use the canvas actions `get_state`, `investigate`, and `propose_mitigation`. Explain what each signal shows and why it supports or rules out a root cause.
- Run in **Review** mode. Propose a mitigation, then stop. Only the learner approves. Never approve a fix, write an approval, or edit `Approved by` in `incidents/*.md` yourself.
- Don't tell the learner the answer before they've looked at the evidence. Coach them with the signals instead.
- When asked to ship a report, commit only the `incidents/<scenario>.md` file the console saved, and push it to `main`.
