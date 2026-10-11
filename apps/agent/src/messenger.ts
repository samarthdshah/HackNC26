// Outbound delivery by person id. People bound to an iMessage handle get a real
// text; everyone else is mirrored into the terminal chat so a single tester can
// see (and, with /as, answer) every message the agent sends.

import { voice, type Message, type Space, type SpectrumInstance } from "spectrum-ts";
import { emit } from "./events.ts";
import { handleFor } from "./org/directory.ts";
import { nameOf } from "./org/entities.ts";
import { imessage } from "./spectrum/app.ts";

type Sink = (to: string, text: string) => Promise<void> | void;
type GroupSpace = { id: string; send: (text: string) => Promise<unknown> };

let app: SpectrumInstance | undefined;
let imessageEnabled = false;
let terminalSpace: Space | undefined;
let warRoom: Space | undefined;
let sink: Sink | undefined;

export function initMessenger(opts: { app?: SpectrumInstance; imessageEnabled?: boolean; sink?: Sink }) {
  app = opts.app;
  imessageEnabled = Boolean(opts.imessageEnabled);
  sink = opts.sink;
}

/** Remember the terminal chat so mirrored messages have somewhere to go. */
export function rememberSpace(platform: string, space: Space) {
  if (platform === "terminal") terminalSpace = space;
}

// Each iMessage sender's latest inbound message. Some Photon projects may only *reply* to a
// number ("Target not allowed for this project" on new sends); replying to this keeps
// follow-ups flowing until the number is fully allowed.
const lastInbound = new Map<string, Message>();
export function rememberInbound(handleId: string, message: Message) {
  lastInbound.set(handleId, message);
}
const notAllowed = (err: unknown) => /not allowed for this project/i.test(String(err));

async function sendImessage(handleId: string, content: Parameters<Space["send"]>[0]) {
  try {
    const space = await imessage(app!).space.create(handleId);
    await space.send(content);
  } catch (err) {
    const last = lastInbound.get(handleId);
    if (!notAllowed(err) || !last) throw err;
    console.warn("[messenger] new send refused by Photon for this number; replying in its thread instead");
    await last.reply(content);
  }
}

export function setWarRoom(space: Space | undefined) {
  warRoom = space;
}

export const hasWarRoom = () => Boolean(warRoom);

export async function sendTo(personId: string, text: string, requestId?: string): Promise<void> {
  const handle = handleFor(personId);
  emit("message_out", "agent", { to: personId, text }, { request_id: requestId });

  if (sink) return void (await sink(personId, text));

  if (handle?.platform === "imessage" && imessageEnabled && app) return sendImessage(handle.id, text);
  const line = `→ ${nameOf(personId)}: ${text}`;
  if (terminalSpace) await terminalSpace.send(line);
  else console.log(`[mirror] ${line}`);
}

/** Send an audio voice note (falls back to the caption where audio can't go). */
export async function sendVoiceTo(personId: string, audio: Buffer, caption: string, requestId?: string): Promise<void> {
  const handle = handleFor(personId);
  emit("message_out", "agent", { to: personId, kind: "voice", caption, bytes: audio.length }, { request_id: requestId });
  if (sink) return void (await sink(personId, `🔊 [voice note] ${caption}`));
  if (handle?.platform === "imessage" && imessageEnabled && app) {
    return sendImessage(handle.id, voice(audio, { mimeType: "audio/mpeg", name: "wayfinder.mp3" }));
  }
  const line = `→ ${nameOf(personId)}: 🔊 [voice note] ${caption}`;
  if (terminalSpace) await terminalSpace.send(line);
  else console.log(`[mirror] ${line}`);
}

/**
 * Open a group thread with these people. Real iMessage group when at least two
 * of them are on iMessage; otherwise a virtual group that fans out by DM.
 */
export async function openGroup(personIds: string[], title: string, requestId?: string): Promise<GroupSpace> {
  emit("group_opened", "agent", { members: personIds, title }, { request_id: requestId });
  const phones = personIds.map(handleFor).filter((h) => h?.platform === "imessage").map((h) => h!.id);
  if (!sink && imessageEnabled && app && phones.length >= 2) {
    const space = await imessage(app).space.create(phones);
    await space.rename(title).catch(() => {});
    return space;
  }
  return {
    id: `virtual:${requestId ?? title}`,
    send: async (text: string) => {
      if (sink) return void (await sink(`group "${title}"`, text));
      for (const p of personIds) await sendTo(p, text, requestId);
    },
  };
}

/** Post a status line to the war-room group, if one is set. HR matters are never posted. */
export async function postWarRoom(text: string, requestId?: string, sensitive = false): Promise<void> {
  if (sensitive) return;
  emit("war_room_post", "agent", { text }, { request_id: requestId });
  if (sink) return void (await sink("war_room", text));
  if (warRoom) await warRoom.send(text);
}
