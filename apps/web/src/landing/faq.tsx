"use client";

import * as stylex from "@stylexjs/stylex";
import { useState } from "react";
import { color, font } from "./tokens.stylex";

const styles = stylex.create({
  item: {
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: color.line,
  },
  button: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) 20px",
    alignItems: "center",
    gap: 16,
    width: "100%",
    paddingBlock: 22,
    paddingInline: 0,
    backgroundColor: "transparent",
    color: color.fg,
    borderWidth: 0,
    fontFamily: font.mono,
    fontSize: 16,
    textAlign: "left",
    cursor: "pointer",
    outlineColor: color.fg,
    outlineOffset: 4,
  },
  sign: { fontSize: 20, lineHeight: 1, textAlign: "right", color: color.muted },
  answer: { margin: 0, paddingBottom: 24, maxWidth: "60ch", color: color.muted, lineHeight: 1.7 },
});

export interface Question {
  ask: string;
  answer: string;
}

export function Faq({ questions }: { questions: Question[] }) {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <div>
      {questions.map((question, index) => {
        const shown = open === index;
        return (
          <div key={question.ask} {...stylex.props(styles.item)}>
            <button type="button" aria-expanded={shown} onClick={() => setOpen(shown ? null : index)} {...stylex.props(styles.button)}>
              <span>{question.ask}</span>
              <span aria-hidden="true" {...stylex.props(styles.sign)}>{shown ? "−" : "+"}</span>
            </button>
            {shown && <p {...stylex.props(styles.answer)}>{question.answer}</p>}
          </div>
        );
      })}
    </div>
  );
}
