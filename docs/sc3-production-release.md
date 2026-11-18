# Salary CAPtain 3.0 production release

Released November 18, 2026 Pacific at https://salarycaptain.vercel.app.

- Application commit: `322cab27f6b1869313453702a522cf2974323ac8` from `feature/salarycaptain-3-expanded`.
- Production deployment: `dpl_Gwzp5y9uHxiLiuBfeSr3EGLrNrmv`. The canonical domain resolved to this READY deployment after promotion.
- Previous 2.0 deployment and rollback target: `dpl_DHB7w5tEkGrmpNCU6aikffckGRhP`.
- GitHub Actions: Salary CAPtain 3.0 Tests and Yahoo OAuth Tests passed for the deployed commit.
- Anonymous HTTP checks: homepage and optimizer returned 200. Streaming, matchup lineup, player card and official matchup API reads returned 401.
- Existing owner session in Windows Chrome: verified live league rosters, streaming, matchup lineups and official scoreboard. A real player evaluation returned the selected add/drop comparison on the canonical domain.
- The release promoted the tested production build directly. This documentation commit does not change the deployed application.
