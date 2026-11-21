import type {
  APIChatInputApplicationCommandInteraction,
  APIInteractionResponse,
} from "discord-api-types/v10";
import { createDb } from "../../db/client.js";
import { getKartuProfileStats } from "../../db/queries/kartu.js";
import {
  deferredResponse,
  ephemeralResponse,
  invokerId,
  patchOriginal,
  postFollowupFile,
} from "../../discord/rest.js";
import {
  computeJabatan,
  deriveBirthInfo,
  deriveBloodType,
  deriveNim,
  formatAndalan,
  formatIndonesianDate,
  formatKoleksiRingkas,
  formatPoolFavorit,
  resolveJoinTimestamp,
} from "../../domain/kartu.js";
import type { Env } from "../../env.js";
import { reportError } from "../../observability.js";
import {
  decodePngToRgba,
  renderKartuPng,
  type DecodedRgbaImage,
} from "../../ui/kartuImage.js";
import type { WaitUntil } from "../registry.js";

export interface CallerMemberIdentity {
  readonly userId: string;
  readonly username: string;
  readonly displayName: string;
  readonly joinedAtIso: string | null;
  readonly avatarUrl: string | null;
}

function buildAvatarUrl(
  userId: string,
  userAvatar: string | null | undefined,
  guildId: string | null | undefined,
  memberAvatar: string | null | undefined,
): string | null {
  if (
    typeof guildId === "string" &&
    guildId !== "" &&
    typeof memberAvatar === "string" &&
    memberAvatar !== ""
  ) {
    return `https://cdn.discordapp.com/guilds/${guildId}/users/${userId}/avatars/${memberAvatar}.png?size=128`;
  }
  if (typeof userAvatar === "string" && userAvatar !== "") {
    return `https://cdn.discordapp.com/avatars/${userId}/${userAvatar}.png?size=128`;
  }
  return null;
}

function pickDisplayName(
  nick: string | null | undefined,
  globalName: string | null | undefined,
  username: string | null | undefined,
  fallbackId: string,
): string {
  if (typeof nick === "string" && nick.trim() !== "") return nick.trim();
  if (typeof globalName === "string" && globalName.trim() !== "") {
    return globalName.trim();
  }
  if (typeof username === "string" && username.trim() !== "") {
    return username.trim();
  }
  return fallbackId;
}

export function extractCallerIdentity(
  interaction: APIChatInputApplicationCommandInteraction,
): CallerMemberIdentity | null {
  const callerId = invokerId(interaction);
  if (callerId === null) return null;

  const member = interaction.member;
  const user = member?.user ?? interaction.user;
  const username = user?.username ?? callerId;

  return {
    userId: callerId,
    username,
    displayName: pickDisplayName(
      member?.nick,
      user?.global_name,
      user?.username,
      callerId,
    ),
    joinedAtIso: member?.joined_at ?? null,
    avatarUrl: buildAvatarUrl(
      callerId,
      user?.avatar,
      interaction.guild_id,
      member?.avatar,
    ),
  };
}

async function fetchAvatarRgba(
  avatarUrl: string | null,
): Promise<DecodedRgbaImage | null> {
  if (avatarUrl === null) return null;
  try {
    const res = await fetch(avatarUrl);
    if (!res.ok) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    return await decodePngToRgba(buf);
  } catch {
    return null;
  }
}

async function runKartuTask(
  env: Env,
  appId: string,
  token: string,
  caller: CallerMemberIdentity,
): Promise<void> {
  try {
    const db = createDb(env);
    const nowSec = Math.floor(Date.now() / 1000);
    const [stats, avatar] = await Promise.all([
      getKartuProfileStats(db, caller.userId),
      fetchAvatarRgba(caller.avatarUrl),
    ]);

    const joinSec = resolveJoinTimestamp(
      caller.joinedAtIso,
      stats.userCreatedAt,
      stats.firstCardAt,
      nowSec,
    );
    const jabatan = computeJabatan(stats.highestRarity, stats.uniqueMembers);

    const pngBytes = await renderKartuPng({
      userId: caller.userId,
      displayName: caller.displayName,
      username: caller.username,
      nim: deriveNim(caller.userId),
      bloodType: deriveBloodType(caller.userId),
      birthInfo: deriveBirthInfo(caller.userId),
      koleksiText: formatKoleksiRingkas(
        stats.totalCards,
        stats.uniqueMembers,
        stats.totalHolo,
      ),
      joinedText: formatIndonesianDate(joinSec),
      jabatanTitle: jabatan.title,
      jabatanColorHex: jabatan.colorHex,
      andalanText: formatAndalan(stats.topMemberName, stats.uniqueMembers),
      poolFavoritText: formatPoolFavorit(stats.topPool),
      berlakuText: "Seumur Hidup",
      avatar,
    });

    await postFollowupFile(appId, token, env.DISCORD_BOT_TOKEN, {
      filename: "kartu-identitas.png",
      contentType: "image/png",
      bytes: pngBytes,
    });
  } catch (err) {
    reportError("kartu:runKartuTask", err);
    try {
      await patchOriginal(appId, token, env.DISCORD_BOT_TOKEN, {
        content: "D1 sibuk/kuota habis, coba lagi.",
      });
    } catch {
      // Never throw out of waitUntil.
    }
  }
}

export function handleKartu(
  interaction: APIChatInputApplicationCommandInteraction,
  env: Env,
  waitUntil: WaitUntil,
): APIInteractionResponse {
  const caller = extractCallerIdentity(interaction);
  if (caller === null) {
    return ephemeralResponse("Tidak bisa membaca identitasmu.");
  }
  waitUntil(
    runKartuTask(env, interaction.application_id, interaction.token, caller),
  );
  return deferredResponse();
}
