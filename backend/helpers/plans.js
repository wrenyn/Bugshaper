export const plans = Object.freeze({
  free: { id: "free", name: "Free", price: 0, members: 3, reports: 50, projects: 2, description: "For getting your first bugs into shape." },
  pro: { id: "pro", name: "Pro", price: 19, members: 10, reports: 1000, projects: 10, description: "For small teams shipping every week." },
  business: { id: "business", name: "Business", price: 49, members: 50, reports: 10000, projects: 100, description: "For growing teams working across products." },
});
