import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ParentApp } from "./parent/ParentApp";
import "./shared/styles.css";
import { ThemePicker } from "./shared/ThemePicker";
import { StudentApp } from "./student/StudentApp";

const isParent = location.pathname.startsWith("/parent");
document.title = isParent ? "Tinjauan Orang Tua · CAT Simulator" : "Latihan CAT";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {isParent ? <ParentApp /> : <StudentApp />}
    <ThemePicker />
  </StrictMode>,
);
