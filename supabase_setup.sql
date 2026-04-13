-- TKG Barcode Ops - Supabase Setup Script
-- Run this entire script in the Supabase SQL Editor to initialize your database.

-- 1. Create Stock Ledger Table
CREATE TABLE IF NOT EXISTS public.stock_ledger (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    product_name TEXT NOT NULL,
    transaction_type TEXT NOT NULL CHECK (transaction_type IN ('INBOUND', 'OUTBOUND', 'DEFECT', 'ADJUSTMENT')),
    qty INTEGER NOT NULL,
    expiry TEXT,
    batch_id TEXT,
    reference_id TEXT, -- E.g. Order ID, AWB, or Defect Log ID
    notes TEXT
);

-- 2. Create Orders Table
CREATE TABLE IF NOT EXISTS public.orders (
    id TEXT PRIMARY KEY, -- e.g. "SHOP-12345" or "B2B-datetime"
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    status TEXT NOT NULL, -- "Complete", "Pending", "Exported"
    platform TEXT, -- "shopee", "lazada", "tiktok", "shopify", "b2b"
    order_data JSONB NOT NULL -- The massive JSON blob for line items
);

-- 3. Create Defects Table
CREATE TABLE IF NOT EXISTS public.defects (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    product TEXT NOT NULL,
    count INTEGER NOT NULL,
    expiry TEXT,
    defect_type TEXT NOT NULL,
    notes TEXT
);

-- 4. Create App Settings Table 
-- (Used for custom product mappings, overrides)
CREATE TABLE IF NOT EXISTS public.app_settings (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 5. Create Core Products Table (V2 SYSTEM)
-- This replaces the massive JSON blob with a formal database table.
CREATE TABLE IF NOT EXISTS public.products (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL, -- 'single', 'bundle', 'giftbox'
    barcodes TEXT[] DEFAULT '{}',
    image TEXT,
    base_product TEXT,
    components JSONB DEFAULT '[]', -- Recipe contents
    require_inner_scan BOOLEAN DEFAULT false,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- 6. Enable Row Level Security (RLS)
ALTER TABLE public.stock_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.defects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

-- 7. Create permissive policies for an internal Tool 
-- Since this is an internal dashboard, we allow all Anon Key connections to read/write freely.
DROP POLICY IF EXISTS "Enable all access for stock_ledger" ON public.stock_ledger;
CREATE POLICY "Enable all access for stock_ledger" ON public.stock_ledger FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Enable all access for orders" ON public.orders;
CREATE POLICY "Enable all access for orders" ON public.orders FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Enable all access for defects" ON public.defects;
CREATE POLICY "Enable all access for defects" ON public.defects FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Enable all access for app_settings" ON public.app_settings;
CREATE POLICY "Enable all access for app_settings" ON public.app_settings FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Enable all access for products" ON public.products;
CREATE POLICY "Enable all access for products" ON public.products FOR ALL USING (true) WITH CHECK (true);

-- 8. Add Indexes for Performance
CREATE INDEX IF NOT EXISTS idx_stock_product ON public.stock_ledger (product_name);
CREATE INDEX IF NOT EXISTS idx_stock_type ON public.stock_ledger (transaction_type);
CREATE INDEX IF NOT EXISTS idx_orders_status ON public.orders (status);
CREATE INDEX IF NOT EXISTS idx_orders_platform ON public.orders (platform);

-- 9. Storage Security Policies for 'product-images' Bucket
-- These permit anyone using the dashboard (Anon Key) to securely upload and replace images.
DROP POLICY IF EXISTS "Public Upload to product-images" ON storage.objects;
CREATE POLICY "Public Upload to product-images" ON storage.objects FOR INSERT TO public WITH CHECK (bucket_id = 'product-images');

DROP POLICY IF EXISTS "Public Update to product-images" ON storage.objects;
CREATE POLICY "Public Update to product-images" ON storage.objects FOR UPDATE TO public USING (bucket_id = 'product-images');

DROP POLICY IF EXISTS "Public Select to product-images" ON storage.objects;
CREATE POLICY "Public Select to product-images" ON storage.objects FOR SELECT TO public USING (bucket_id = 'product-images');
