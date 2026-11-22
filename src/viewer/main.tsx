import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { readViewerOptions } from "./embedProtocol";
import { ViewerApp } from "./ViewerApp";
import "../styles.css";
import "./viewer.css";

const root = document.getElementById("root");
if (!root) throw new Error("PackCAD viewer root element is missing");

const options = readViewerOptions(window.location.search);

createRoot(root).render(
  <StrictMode>
    <ViewerApp options={options} />
  </StrictMode>,
);
