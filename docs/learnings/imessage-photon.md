# iMessage and Photon

Photon Spectrum connects the agent to iMessage. Five rules matter in practice:
1. Only one agent may be connected per Photon project.
2. A number must be allowed in the project before the agent can text it.
3. Until it's allowed, the agent can only *reply* to that number.
4. Every scenario uses the same Wayfinder number.
5. `/iam` decides who your phone is.

*Written 2026-10-11 after the first live tests.*

## One agent per Photon project

Photon delivers every inbound text to **every** agent connected to the project. If a teammate is running `apps/agent` with the same `PHOTON_PROJECT_ID`, both agents act on each message.

What we saw:
- two "On it… Plan:" messages for one request;
- the copy nobody answered nudged Raj, escalated to Dana, hit a network error, and finally went **stuck**, texting the tester throughout.

Both agents also write to the same Tiger database, so the website shows the duplicate request.

**Rule:** before testing, confirm nobody else has the agent running. To test in parallel, use separate Photon projects.

**Tell:** if your phone shows two plans for one message, a second agent is connected.

## Allowed numbers and reply-only mode

- New sends to a number not allowed in the project fail with `Target not allowed for this project`. That includes the typing indicator and attachments such as voice notes.
- **Replying** to a message the person sent still works.
- The agent now copes with this (`apps/agent/src/index.ts`, `messenger.ts`). If the typing indicator is refused, it handles the message without it. If a new send is refused, it replies in the person's latest thread instead.
- Once the number is allowed in the Photon dashboard, normal sends resume automatically. The allowlist change took a few minutes to apply.

The agent's iMessage number isn't in the repo or exposed by the SDK. It's on the Photon dashboard for the project.

## Testing with one phone

- Every scenario texts the **same Wayfinder number**. Only your persona changes.
- `/iam <name>` binds your phone to that person, and the previous persona goes back to unbound. `/whoami` and `/status` check where you are.
- Wayfinder's texts to unbound people (Raj, Tom, …) go to the agent log, or the terminal chat, as `[mirror] → Name: …`.
- Someone answers for them through:
  - the website compose box (`/currents?me=p_raj`), or
  - `POST /say` (what Claude used in testing), or
  - `/as raj` in the agent's own terminal, or
  - a teammate's phone bound with `/iam raj`. This is the most realistic for a demo.
- Switch personas between scenarios, not during one, or follow-ups for the old persona land in the log.
- With one phone, group threads (RSVPs, intros) fan out as separate DMs. A real group needs 2+ bound phones.

## Who is "thinking"

Wayfinder's brain is **Gemini**, inside the agent server: your text goes to Photon, then the agent, then Gemini, then the reply. A coding assistant playing Raj or Tom during testing is just a stand-in human. It isn't triggered by your texts and isn't part of the product.
