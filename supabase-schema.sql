create table if not exists public.app_users (
  id uuid primary key,
  name text not null,
  email text not null unique,
  role text not null check (role in ('customer', 'driver', 'vendor', 'platform_admin')),
  password_hash text not null,
  vendor_id text,
  created_at timestamptz not null default now()
);

create table if not exists public.tracking_orders (
  id uuid primary key,
  customer_id uuid not null references public.app_users(id),
  driver_id uuid references public.app_users(id),
  local_order_id text not null,
  status text not null check (status in ('new', 'claimed', 'picked_up', 'delivered')),
  shop_name text not null,
  address jsonb not null,
  items jsonb not null,
  total_cents integer not null check (total_cents >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists tracking_orders_open_idx
  on public.tracking_orders (status, created_at)
  where driver_id is null;

create index if not exists tracking_orders_driver_idx
  on public.tracking_orders (driver_id, status, updated_at desc);

create table if not exists public.driver_locations (
  order_id uuid primary key references public.tracking_orders(id) on delete cascade,
  driver_id uuid not null references public.app_users(id),
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  accuracy_m double precision,
  updated_at timestamptz not null default now()
);

alter table public.app_users enable row level security;
alter table public.tracking_orders enable row level security;
alter table public.driver_locations enable row level security;
