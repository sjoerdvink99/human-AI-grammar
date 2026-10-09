// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { App } from "../src/App";

describe("App smoke test", () => {
  it("renders all three process modes", () => {
    render(<App />);
    expect(screen.getByText("Process 1 · Scene")).toBeTruthy();
    expect(screen.getByText("Process 2 · Sketch")).toBeTruthy();
    expect(screen.getByText("Process 3 · Voice collage")).toBeTruthy();
    fireEvent.click(screen.getByText("Voice collage"));
    expect(screen.getByText(/Scene prompt/)).toBeTruthy();
  });
});
