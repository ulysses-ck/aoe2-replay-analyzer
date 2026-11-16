"use client";

import { memo, useState } from "react";

import { formatTime } from "@/lib/types";
import type { ChatMessage, ColorOf, NameOf, Seek } from "../types";
import { focusRing } from "../ui/button-styles";
import { EmptyNote, Panel } from "./Panel";

/** Pastilla del filtro: activa con acento violeta, inactiva apagada. */
function pillClass(active: boolean) {
  return `rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors ${focusRing} ${
    active ? "bg-violet-500/20 text-violet-200" : "bg-white/5 text-zinc-500 hover:text-zinc-300"
  }`;
}

type Props = {
  chat: ChatMessage[];
  /** Reloj de reproducción: filtra los mensajes para mostrarlos acordes al momento. */
  time: number;
  nameOf: NameOf;
  colorOf: ColorOf;
  onSeek: Seek;
};

export const ChatPanel = memo(function ChatPanel({ chat, time, nameOf, colorOf, onSeek }: Props) {
  const [soloEnJuego, setSoloEnJuego] = useState(true);
  const visible = soloEnJuego ? chat.filter((message) => message.t <= time) : chat;
  return (
    <Panel title="Chat" count={visible.length}>
      <div className="mb-2 flex gap-1" role="group" aria-label="Filtro del chat">
        <button
          type="button"
          aria-pressed={soloEnJuego}
          onClick={() => setSoloEnJuego(true)}
          className={soloEnJuego ? pillClass(true) : pillClass(false)}
        >
          Acorde al tiempo
        </button>
        <button
          type="button"
          aria-pressed={!soloEnJuego}
          onClick={() => setSoloEnJuego(false)}
          className={pillClass(!soloEnJuego)}
        >
          Completo
        </button>
      </div>
      {visible.length === 0 ? (
        <EmptyNote>
          {soloEnJuego ? "Sin mensajes hasta este momento." : "Nadie escribió en el chat."}
        </EmptyNote>
      ) : (
        <ul className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
          {visible.map((message, index) => (
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