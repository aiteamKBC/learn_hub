import { Check, Coins } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Menu, MenuContent, MenuItem, MenuLabel, MenuTrigger } from '@/components/ui/menu'
import { useCurrencies } from '@/features/commerce/api'
import { useCurrency } from '@/lib/currency'

/** Prices in the shopper's currency (set on the server; never converted in the browser). */
export function CurrencyMenu() {
  const { data } = useCurrencies()
  const { code, setCurrency } = useCurrency()
  const current = code ?? 'GBP'
  if (!data || data.length < 2) return null
  return (
    <Menu modal={false}>
      <MenuTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-1.5 px-2 font-semibold text-muted" aria-label={`Currency: ${current}`}>
          <Coins /> <span className="tabular">{current}</span>
        </Button>
      </MenuTrigger>
      <MenuContent className="max-h-80 w-60 overflow-y-auto overscroll-contain">
        <MenuLabel>Show prices in</MenuLabel>
        {data.map((c) => (
          <MenuItem key={c.code} onSelect={() => void setCurrency(c.code)}>
            <span className="w-10 font-semibold tabular">{c.code}</span>
            <span className="truncate text-muted">{c.name}</span>
            {c.code === current ? <Check className="ml-auto !text-primary" /> : null}
          </MenuItem>
        ))}
      </MenuContent>
    </Menu>
  )
}
