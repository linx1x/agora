import { AccessToken, RoomServiceClient, TrackSource } from 'livekit-server-sdk';
import type { SfuApi } from './gate';

/** Token lifetime: only checked when connecting; the SFU refreshes it on live connections. */
const TOKEN_TTL = '10m';
const PUBLISH_SOURCES = [
  TrackSource.MICROPHONE,
  TrackSource.CAMERA,
  TrackSource.SCREEN_SHARE,
  TrackSource.SCREEN_SHARE_AUDIO,
];

const absent = (err: unknown) => {
  const e = err as { code?: string; status?: number };
  return e?.code === 'not_found' || e?.status === 404;
};

/** ws(s)://host → http(s)://host for the server API. */
export function apiUrlFrom(wsUrl: string): string {
  return wsUrl.replace(/^ws(s?):\/\//, 'http$1://');
}

export interface LiveKitConfig {
  url: string;
  apiUrl: string;
  apiKey: string;
  apiSecret: string;
}

/** LiveKit implementation of the SFU calls the media gate needs (ADR-031). */
export class LiveKitApi implements SfuApi {
  private svc: RoomServiceClient;

  constructor(private c: LiveKitConfig) {
    this.svc = new RoomServiceClient(c.apiUrl, c.apiKey, c.apiSecret, { requestTimeout: 5 });
  }

  async mint(room: string, identity: string, name: string, canPublish: boolean) {
    const at = new AccessToken(this.c.apiKey, this.c.apiSecret, { identity, name, ttl: TOKEN_TTL });
    at.addGrant({
      roomJoin: true,
      room,
      canSubscribe: true,
      canPublish,
      canPublishSources: canPublish ? PUBLISH_SOURCES : [],
      // positions, chat and presence go through the world room, never the SFU
      canPublishData: false,
      canUpdateOwnMetadata: false,
    });
    return at.toJwt();
  }

  async setPublish(room: string, identity: string, canPublish: boolean) {
    try {
      await this.svc.updateParticipant(room, identity, {
        permission: {
          canSubscribe: true,
          canPublish,
          canPublishData: false,
          canPublishSources: canPublish ? PUBLISH_SOURCES : [],
        },
      });
    } catch (err) {
      if (!absent(err)) throw err;
    }
  }

  async remove(room: string, identity: string) {
    try {
      // tokens issued before now stop working for this person in this room
      await this.svc.removeParticipant(room, identity, {
        revokeTokenTs: BigInt(Math.floor(Date.now() / 1000)),
      });
    } catch (err) {
      if (!absent(err)) throw err;
    }
  }

  async rooms(prefix: string) {
    return (await this.svc.listRooms()).map((r) => r.name).filter((n) => n.startsWith(prefix));
  }

  async participants(room: string) {
    try {
      return (await this.svc.listParticipants(room)).map((p) => ({
        identity: p.identity,
        canPublish: !!p.permission?.canPublish,
      }));
    } catch (err) {
      if (absent(err)) return [];
      throw err;
    }
  }

  /** Startup check: can the server reach the LiveKit API with these credentials? */
  async ping(): Promise<void> {
    await this.svc.listRooms();
  }
}
