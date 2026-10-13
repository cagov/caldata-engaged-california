import { mount } from "svelte";
import App from "./App.svelte";
import "./styles/ec-tokens.css";

const target = document.getElementById("app");
if (!target) throw new Error("#app root element missing from index.html");

mount(App, { target });
