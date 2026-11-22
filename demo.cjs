const anchor = require("@anchor-lang/core");
const web3 = require("@solana/web3.js");
const fs = require("fs");
const os = require("os");
const idl = require("./idl/registro.json");

const { Program, AnchorProvider, Wallet } = anchor;

const secret = JSON.parse(fs.readFileSync(os.homedir() + "/.config/solana/id.json"));
const keypair = web3.Keypair.fromSecretKey(Uint8Array.from(secret));
const connection = new web3.Connection("https://api.devnet.solana.com", "confirmed");
const provider = new AnchorProvider(connection, new Wallet(keypair), { commitment: "confirmed" });
const program = new Program(idl, provider);
const programId = program.programId;
const owner = keypair.publicKey;
const NEGOCIO = "Cafe WayLearn";

const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16LE(n, 0); return b; };
const pdaRegistro = () => web3.PublicKey.findProgramAddressSync([Buffer.from("registro"), Buffer.from(NEGOCIO), owner.toBuffer()], programId)[0];
const pdaCliente = (reg, id) => web3.PublicKey.findProgramAddressSync([Buffer.from("cliente"), reg.toBuffer(), u16(id)], programId)[0];
const pdaVenta = (cli, sku) => web3.PublicKey.findProgramAddressSync([Buffer.from("venta"), cli.toBuffer(), Buffer.from(sku)], programId)[0];
const link = (sig) => "https://explorer.solana.com/tx/" + sig + "?cluster=devnet";

async function paso(titulo, fn) {
  console.log("\n=== " + titulo + " ===");
  try {
    const sig = await fn();
    if (sig) console.log("OK  tx:", link(sig));
  } catch (e) {
    const msg = (e && e.error && e.error.errorMessage) || (e && e.message) || String(e);
    const code = (e && e.error && e.error.errorCode && e.error.errorCode.code) || "";
    console.log("RECHAZADO/ERROR:", code, "-", msg);
  }
}

async function main() {
  console.log("Wallet:", owner.toBase58());
  console.log("Program ID:", programId.toBase58());
  const registro = pdaRegistro();

  await paso("1. Crear registro", () =>
    program.methods.crearRegistro(NEGOCIO).accountsPartial({ owner, registro }).rpc());

  const reg = await program.account.registro.fetch(registro);
  const id = reg.idCounter + 1;
  const cliente = pdaCliente(registro, id);
  const venta = pdaVenta(cliente, "CAF01");
  const ventaMala = pdaVenta(cliente, "CAF02");

  await paso("2. Crear cliente Ana", () =>
    program.methods.crearCliente("Ana").accountsPartial({ owner, registro, cliente }).rpc());

  await paso("3. Registrar venta CAF01 por 50", () =>
    program.methods.registrarVenta(id, "CAF01", "Cafe americano", 50)
      .accountsPartial({ owner, registro, cliente, venta }).rpc());

  await paso("4. RECHAZO esperado: venta con monto 0", () =>
    program.methods.registrarVenta(id, "CAF02", "Prueba monto cero", 0)
      .accountsPartial({ owner, registro, cliente, venta: ventaMala }).rpc());

  await paso("5. Cambiar monto a 55", () =>
    program.methods.cambiarMonto(id, "CAF01", 55)
      .accountsPartial({ owner, registro, cliente, venta }).rpc());

  await paso("6. RECHAZO esperado: eliminar cliente con ventas activas", () =>
    program.methods.eliminarCliente(id)
      .accountsPartial({ owner, registro, cliente }).rpc());

  const v = await program.account.venta.fetch(venta);
  console.log("\nVenta guardada:", v.sku, "|", v.descripcion, "| monto", v.monto);

  await paso("7. Devolucion de CAF01", () =>
    program.methods.hacerDevolucion(id, "CAF01")
      .accountsPartial({ owner, registro, cliente, venta }).rpc());

  await paso("8. Eliminar cliente (ya sin ventas)", () =>
    program.methods.eliminarCliente(id)
      .accountsPartial({ owner, registro, cliente }).rpc());

  const regFinal = await program.account.registro.fetch(registro);
  console.log("\nClientes en el registro al final:", regFinal.clientes.length);
}
main();
