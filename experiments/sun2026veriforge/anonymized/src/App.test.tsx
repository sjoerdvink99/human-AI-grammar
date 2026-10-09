// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import App from "./App";

describe("App", () => {
  it("renders the three columns and loads the example", () => {
    localStorage.clear();
    render(<App />);
    expect(screen.getByText("Sources")).toBeTruthy();
    expect(screen.getByText("Writing map")).toBeTruthy();
    fireEvent.click(screen.getByText("Load example"));
    expect(screen.getByText("Coral bleaching and marine heatwaves")).toBeTruthy();
    fireEvent.click(screen.getByText("Ask the sources"));
    expect(screen.getByPlaceholderText(/Build the knowledge graph first/)).toBeTruthy();
  });
});
