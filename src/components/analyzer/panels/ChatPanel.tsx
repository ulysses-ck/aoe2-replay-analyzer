"use client";

import { memo } from "react";

import { formatTime } from "@/lib/types";
import type { ChatMessage, ColorOf, NameOf, Seek } from "../types";
import { focusRing } from "../ui/button-styles";
import { EmptyNote, Panel } from "./Panel";

type Props = { chat: ChatMessage[]; nameOf: NameOf; colorOf: ColorOf; onSeek: Seek };

export const ChatPanel = memo(function ChatPanel({ chat, nameOf, colorOf, onSeek }: Props) {
  return (
    <Panel title="Chat" count={chat.length}>
      {chat.length === 0 ? (
        <EmptyNote>Nadie escribió en el chat.</EmptyNote>
      ) : (
        <ul className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
          {chat.map((message, index) => (
            <li key={index} className="text-xs leading-snug">
              {/* Solo la hora es clickeable, así el texto se puede seleccionar y copiar. */}
              <button
                type="button"
                onClick={() => onSeek(message.t)}
                title="Ir a este momento"
                className={`mr-1.5 rounded font-mono text-[10px] tabular-nums text-zinc-500 transition-colors hover:text-zinc-200 ${focusRing}`}
              >
                {formatTime(message.t)}
              </button>
              <span
                className={message.system ? "font-medium italic" : "font-medium"}
                style={{ color: colorOf(message.playerId) }}
              >
                {nameOf(message.playerId)}
              </span>{" "}
              <span className={message.system ? "italic text-zinc-500" : "text-zinc-300"}>{message.text}</span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
});