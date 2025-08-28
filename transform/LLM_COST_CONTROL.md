# LLM Model Cost Control

## Overview
To control AI processing costs, this project automatically uses different LLM models based on your dbt target:

- **Development** (`--target dev`): `llama4-maverick` (cheaper, faster)
- **Production** (`--target prd`): `claude-4-sonnet` (higher quality, more expensive)

## Automatic Model Selection

The model is automatically selected based on your dbt target in `dbt_project.yml`:
```yaml
vars:
  llm_model: "{{ 'claude-4-sonnet' if target.name == 'prd' else 'llama4-maverick' }}"
```

## Usage Examples

### Development (Cheaper Model)
```bash
# Uses llama4-maverick automatically
dbt run --target dev --select int_extracted_problems

# Default target is 'dev', so this also uses the cheaper model
dbt run --select int_extracted_problems
```

### Production (Better Model)
```bash
# Uses claude-4-sonnet automatically
dbt run --target prd --select int_extracted_problems+
```

### Testing with Limited Data
```bash
# Development with limited records to minimize cost
dbt run --target dev --select int_extracted_problems --vars '{"limit": 10}'
```

## Files Using LLM Models
The following models automatically use the appropriate model based on target:

1. `int_extracted_problems.sql` - Problem extraction from comments
2. `int_extracted_solutions.sql` - Solution extraction from comments
3. `int_problem_solution_links.sql` - Semantic matching of problems to solutions
4. `e3_consolidated_problem_solutions.sql` - AI consolidation of solutions

## Cost Monitoring
- Monitor your Snowflake Cortex AI credits usage
- Development model should cost ~90% less than production model
- Use `--target dev` for all development and testing
- Only use `--target prd` for final production runs

## Target Configuration
Your profiles.yml has these targets configured:
- `dev` (default) → `llama4-maverick`
- `prd` → `claude-4-sonnet`

No manual switching required - just use the appropriate `--target` flag.
