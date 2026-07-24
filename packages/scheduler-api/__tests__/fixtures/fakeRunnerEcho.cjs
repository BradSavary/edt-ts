// Faux runner CP-SAT : lit stdin, renvoie { echo: <payload reçu> } sur stdout, exit 0.
// Utilisé par cpsatGateway.test.ts pour vérifier l'acheminement stdin/stdout sans dépendance Python.
let input = '';
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  const payload = JSON.parse(input);
  process.stdout.write(JSON.stringify({ echo: payload }));
  process.exit(0);
});
