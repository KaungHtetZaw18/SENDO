import React from "react";
import ReactDOM from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import "./index.css";
import App from "./App.jsx";
import Receiver from "./pages/Receiver.jsx";
import Sender from "./pages/Sender.jsx";

const Router = createBrowserRouter([
  { path: "/", element: <App /> },
  { path: "/receiver", element: <Receiver /> },
  { path: "/sender", element: <Sender /> },
]);

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <RouterProvider router={Router} />
  </React.StrictMode>
);
