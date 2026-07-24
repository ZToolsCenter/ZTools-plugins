import { mount } from "svelte";

import App from "./App.svelte";
import { installAtoolsVisualFixture } from "./visual-fixture";

installAtoolsVisualFixture();

mount(App, { target: document.getElementById("app")! });
