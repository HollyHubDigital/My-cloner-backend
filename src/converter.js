// CSS to Tailwind conversion mapping - Extended
const cssToTailwindMap = {
  // Display properties
  'display:\\s*flex': 'flex',
  'display:\\s*block': 'block',
  'display:\\s*inline-block': 'inline-block',
  'display:\\s*grid': 'grid',
  'display:\\s*none': 'hidden',
  'display:\\s*inline': 'inline',
  'display:\\s*table': 'table',
  
  // Text alignment
  'text-align:\\s*center': 'text-center',
  'text-align:\\s*left': 'text-left',
  'text-align:\\s*right': 'text-right',
  'text-align:\\s*justify': 'text-justify',
  
  // Flexbox alignment
  'justify-content:\\s*center': 'justify-center',
  'justify-content:\\s*flex-start': 'justify-start',
  'justify-content:\\s*flex-end': 'justify-end',
  'justify-content:\\s*space-between': 'justify-between',
  'justify-content:\\s*space-around': 'justify-around',
  'justify-content:\\s*space-evenly': 'justify-evenly',
  
  'align-items:\\s*center': 'items-center',
  'align-items:\\s*flex-start': 'items-start',
  'align-items:\\s*flex-end': 'items-end',
  'align-items:\\s*stretch': 'items-stretch',
  'align-items:\\s*baseline': 'items-baseline',
  
  // Spacing - Padding
  'padding:\\s*0\\.25rem': 'p-1',
  'padding:\\s*0\\.5rem': 'p-2',
  'padding:\\s*0\\.75rem': 'p-3',
  'padding:\\s*1rem': 'p-4',
  'padding:\\s*1\\.5rem': 'p-6',
  'padding:\\s*2rem': 'p-8',
  'padding:\\s*3rem': 'p-12',
  'padding-top:\\s*1rem': 'pt-4',
  'padding-bottom:\\s*1rem': 'pb-4',
  'padding-left:\\s*1rem': 'pl-4',
  'padding-right:\\s*1rem': 'pr-4',
  
  // Spacing - Margin
  'margin:\\s*0\\.25rem': 'm-1',
  'margin:\\s*0\\.5rem': 'm-2',
  'margin:\\s*1rem': 'm-4',
  'margin:\\s*2rem': 'm-8',
  'margin:\\s*3rem': 'm-12',
  'margin-top:\\s*1rem': 'mt-4',
  'margin-bottom:\\s*1rem': 'mb-4',
  'margin-left:\\s*1rem': 'ml-4',
  'margin-right:\\s*1rem': 'mr-4',
  'margin-top:\\s*auto': 'mt-auto',
  'margin-bottom:\\s*auto': 'mb-auto',
  'margin-left:\\s*auto': 'ml-auto',
  'margin-right:\\s*auto': 'mr-auto',
  
  // Gap
  'gap:\\s*0\\.5rem': 'gap-2',
  'gap:\\s*1rem': 'gap-4',
  'gap:\\s*2rem': 'gap-8',
  'row-gap:\\s*1rem': 'gap-y-4',
  'column-gap:\\s*1rem': 'gap-x-4',
  
  // Dimensions
  'width:\\s*100%': 'w-full',
  'width:\\s*50%': 'w-1/2',
  'width:\\s*auto': 'w-auto',
  'height:\\s*100%': 'h-full',
  'height:\\s*100vh': 'h-screen',
  'height:\\s*auto': 'h-auto',
  'min-height:\\s*100vh': 'min-h-screen',
  
  // Typography
  'font-weight:\\s*300': 'font-light',
  'font-weight:\\s*400': 'font-normal',
  'font-weight:\\s*500': 'font-medium',
  'font-weight:\\s*600': 'font-semibold',
  'font-weight:\\s*700': 'font-bold',
  'font-weight:\\s*800': 'font-extrabold',
  'font-weight:\\s*bold': 'font-bold',
  
  'font-size:\\s*0\\.75rem': 'text-xs',
  'font-size:\\s*0\\.875rem': 'text-sm',
  'font-size:\\s*1rem': 'text-base',
  'font-size:\\s*1\\.125rem': 'text-lg',
  'font-size:\\s*1\\.25rem': 'text-lg',
  'font-size:\\s*1\\.5rem': 'text-xl',
  'font-size:\\s*1\\.875rem': 'text-2xl',
  'font-size:\\s*2\\.25rem': 'text-3xl',
  'font-size:\\s*3rem': 'text-4xl',
  
  'line-height:\\s*1': 'leading-none',
  'line-height:\\s*1\\.25': 'leading-tight',
  'line-height:\\s*1\\.5': 'leading-normal',
  'line-height:\\s*1\\.75': 'leading-relaxed',
  'line-height:\\s*2': 'leading-loose',
  
  'text-decoration:\\s*none': 'no-underline',
  'text-decoration:\\s*underline': 'underline',
  'text-decoration:\\s*line-through': 'line-through',
  
  // Colors (basic)
  'color:\\s*#fff': 'text-white',
  'color:\\s*#ffffff': 'text-white',
  'color:\\s*white': 'text-white',
  'color:\\s*#000': 'text-black',
  'color:\\s*#000000': 'text-black',
  'color:\\s*black': 'text-black',
  'background-color:\\s*#fff': 'bg-white',
  'background-color:\\s*#ffffff': 'bg-white',
  'background-color:\\s*white': 'bg-white',
  'background-color:\\s*#f3f4f6': 'bg-gray-100',
  'background-color:\\s*#000': 'bg-black',
  'background-color:\\s*#000000': 'bg-black',
  'background-color:\\s*black': 'bg-black',
  'background:\\s*white': 'bg-white',
  'background:\\s*black': 'bg-black',
  
  // Border
  'border-radius:\\s*0': 'rounded-none',
  'border-radius:\\s*0\\.25rem': 'rounded-sm',
  'border-radius:\\s*0\\.375rem': 'rounded',
  'border-radius:\\s*0\\.5rem': 'rounded',
  'border-radius:\\s*1rem': 'rounded-lg',
  'border-radius:\\s*1\\.5rem': 'rounded-xl',
  'border-radius:\\s*9999px': 'rounded-full',
  
  'border:\\s*1px': 'border',
  'border:\\s*2px': 'border-2',
  'border-top:\\s*1px': 'border-t',
  'border-bottom:\\s*1px': 'border-b',
  'border-left:\\s*1px': 'border-l',
  'border-right:\\s*1px': 'border-r',
  
  // Shadows
  'box-shadow:\\s*0\\s*1px\\s*3px': 'shadow-sm',
  'box-shadow:\\s*0\\s*4px\\s*6px': 'shadow',
  'box-shadow:\\s*0\\s*10px\\s*15px': 'shadow-lg',
  'box-shadow:\\s*none': 'shadow-none',
  
  // Opacity
  'opacity:\\s*0': 'opacity-0',
  'opacity:\\s*0\\.25': 'opacity-25',
  'opacity:\\s*0\\.5': 'opacity-50',
  'opacity:\\s*0\\.75': 'opacity-75',
  'opacity:\\s*1': 'opacity-100',
  
  // Position
  'position:\\s*relative': 'relative',
  'position:\\s*absolute': 'absolute',
  'position:\\s*fixed': 'fixed',
  'position:\\s*sticky': 'sticky',
  'position:\\s*static': 'static',
  
  // Overflow
  'overflow:\\s*hidden': 'overflow-hidden',
  'overflow:\\s*auto': 'overflow-auto',
  'overflow-x:\\s*auto': 'overflow-x-auto',
  'overflow-y:\\s*auto': 'overflow-y-auto',
};

export function convertCSSToTailwind(cssText) {
  if (!cssText) return '';

  let tailwindClasses = new Set();

  for (const [pattern, tailwindClass] of Object.entries(cssToTailwindMap)) {
    if (new RegExp(pattern, 'i').test(cssText)) {
      tailwindClasses.add(tailwindClass);
    }
  }

  return Array.from(tailwindClasses).join(' ');
}

// Extract CSS rules from stylesheet text
export function extractCSSRules(cssText) {
  if (!cssText) return '';
  
  // Simple CSS extraction - keep most CSS as-is since we'll use CDN styles
  // This is a fallback for when converting to Tailwind isn't possible
  return cssText;
}

export async function convertToTailwind(html, styles) {
  // Return HTML as-is, Tailwind CDN will handle styling
  return html;
}
