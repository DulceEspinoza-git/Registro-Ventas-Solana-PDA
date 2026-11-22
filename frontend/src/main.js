import "./polyfill.js";
import * as anchor from "@anchor-lang/core";
import { Connection, PublicKey } from "@solana/web3.js";
import idl from "./idl.json";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const connection = new Connection("https://api.devnet.solana.com", "confirmed");
const PROGRAM_ID = new PublicKey(idl.address);

let program = null;
let owner = null;

// ---------- PDAs (mismas seeds que el programa en Rust) ----------
const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16LE(n, 0); return b; };
const negocio = () => $("negocio").value.trim();
const pdaRegistro = () =>
  PublicKey.findProgramAddressSync([Buffer.from("registro"), Buffer.from(negocio()), owner.toBuffer()], PROGRAM_ID)[0];
const pdaCliente = (registro, id) =>
  PublicKey.findProgramAddressSync([Buffer.from("cliente"), registro.toBuffer(), u16(id)], PROGRAM_ID)[0];
const pdaVenta = (cliente, sku) =>
  PublicKey.findProgramAddressSync([Buffer.from("venta"), cliente.toBuffer(), Buffer.from(sku)], PROGRAM_ID)[0];

// ---------- Log ----------
function log(texto, clase, sig) {
  const d = document.createElement("div");
  d.className = clase;
  d.innerHTML = esc(texto) + (sig
    ? ` — <a target="_blank" href="https://explorer.solana.com/tx/${sig}?cluster=devnet">ver transacción</a>` : "");
  $("log").prepend(d);
}

// Ejecuta una operación: firma con Phantom, confirma, muestra resultado o error
async function run(titulo, fn) {
  if (!program) return alert("Primero conecta Phantom");
  log("Enviando: " + titulo + " (aprueba en Phantom)...", "muted");
  try {
    const sig = await fn();
    log("OK: " + titulo, "ok", sig);
  } catch (e) {
    const msg = e?.error?.errorMessage || e?.message || String(e);
    const code = e?.error?.errorCode?.code || "";
    log("RECHAZADO: " + titulo + " → " + code + " " + msg, "err");
  }
  await refresh();
}

// ---------- Conexión con la wallet ----------
$("btnConectar").onclick = async () => {
  const phantom = window.phantom?.solana ?? window.solana;
  if (!phantom) return alert("No se encontró Phantom. Instala la extensión y recarga la página.");
  await phantom.connect();
  const provider = new anchor.AnchorProvider(connection, phantom, { commitment: "confirmed" });
  program = new anchor.Program(idl, provider);
  owner = phantom.publicKey;
  $("wallet").textContent = " " + owner.toBase58();
  log("Wallet conectada: " + owner.toBase58(), "ok");
  await refresh();
};

// ---------- Lectura y pintado ----------
async function refresh() {
  if (!program) return;
  const bal = await connection.getBalance(owner);
  $("saldo").textContent = "· " + (bal / 1e9).toFixed(3) + " SOL (Devnet)";
  const registroPda = pdaRegistro();
  let reg;
  try {
    reg = await program.account.registro.fetch(registroPda);
  } catch {
    $("datos").innerHTML = `<div class="card">El negocio «${esc(negocio())}» todavía no existe para esta wallet. Pulsa «Crear registro».</div>`;
    $("acciones").hidden = true;
    return;
  }

  const clientes = [];
  for (const key of reg.clientes) {
    const c = await program.account.cliente.fetch(key);
    const ventas = [];
    for (const vk of c.historial) ventas.push(await program.account.venta.fetch(vk));
    clientes.push({ c, ventas });
  }

  let html = `<div class="card"><b>${esc(reg.nombreBusiness ?? reg.nombreNegocio)}</b><br>
    <span class="muted">Dueño: ${esc(reg.owner.toBase58())}<br>
    Cuenta del registro: ${esc(registroPda.toBase58())}<br>
    Último id asignado: ${reg.idCounter} · Clientes activos: ${reg.clientes.length}</span></div>`;

  if (clientes.length === 0) html += `<div class="card muted">Aún no hay clientes.</div>`;
  for (const { c, ventas } of clientes) {
    html += `<div class="card"><b>Cliente #${c.idCliente}: ${esc(c.nombre)}</b>
      <span class="muted"> · compras: ${c.compras}</span>
      <button class="red" data-act="delcli" data-id="${c.idCliente}">Eliminar cliente</button>`;
    if (ventas.length === 0) html += `<div class="venta muted">Sin ventas activas</div>`;
    for (const v of ventas) {
      html += `<div class="venta">${esc(v.sku)} · ${esc(v.descripcion)} · <b>$${v.monto}</b>
        <button class="sec" data-act="monto" data-id="${c.idCliente}" data-sku="${esc(v.sku)}">Cambiar monto</button>
        <button class="sec" data-act="dev" data-id="${c.idCliente}" data-sku="${esc(v.sku)}">Devolución</button></div>`;
    }
    html += `</div>`;
  }
  $("datos").innerHTML = html;
  $("acciones").hidden = false;
  $("selCliente").innerHTML = clientes
    .map(({ c }) => `<option value="${c.idCliente}">#${c.idCliente} ${esc(c.nombre)}</option>`).join("");
}

$("btnCargar").onclick = refresh;

// ---------- Operaciones ----------
$("btnRegistro").onclick = () =>
  run("Crear registro " + negocio(), () =>
    program.methods.crearRegistro(negocio()).accountsPartial({ owner, registro: pdaRegistro() }).rpc());

$("btnCliente").onclick = () =>
  run("Crear cliente " + $("nombreCliente").value, async () => {
    const registro = pdaRegistro();
    const reg = await program.account.registro.fetch(registro);
    const cliente = pdaCliente(registro, reg.idCounter + 1);
    return program.methods.crearCliente($("nombreCliente").value.trim())
      .accountsPartial({ owner, registro, cliente }).rpc();
  });

$("btnVenta").onclick = () =>
  run("Registrar venta " + $("sku").value, () => {
    const id = Number($("selCliente").value);
    const sku = $("sku").value.trim();
    const registro = pdaRegistro();
    const cliente = pdaCliente(registro, id);
    const venta = pdaVenta(cliente, sku);
    return program.methods.registrarVenta(id, sku, $("desc").value.trim(), Number($("monto").value))
      .accountsPartial({ owner, registro, cliente, venta }).rpc();
  });

// Botones dentro de la lista (cambiar monto, devolución, eliminar cliente)
$("datos").onclick = (ev) => {
  const b = ev.target.closest("button[data-act]");
  if (!b) return;
  const id = Number(b.dataset.id);
  const sku = b.dataset.sku;
  const registro = pdaRegistro();
  const cliente = pdaCliente(registro, id);

  if (b.dataset.act === "monto") {
    const nuevo = Number(prompt("Nuevo monto para " + sku + ":"));
    if (!nuevo && nuevo !== 0) return;
    run("Cambiar monto de " + sku, () =>
      program.methods.cambiarMonto(id, sku, nuevo)
        .accountsPartial({ owner, registro, cliente, venta: pdaVenta(cliente, sku) }).rpc());
  }
  if (b.dataset.act === "dev") {
    run("Devolución de " + sku, () =>
      program.methods.hacerDevolucion(id, sku)
        .accountsPartial({ owner, registro, cliente, venta: pdaVenta(cliente, sku) }).rpc());
  }
  if (b.dataset.act === "delcli") {
    run("Eliminar cliente #" + id, () =>
      program.methods.eliminarCliente(id).accountsPartial({ owner, registro, cliente }).rpc());
  }
};
